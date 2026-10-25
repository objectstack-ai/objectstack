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
import { cn, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@object-ui/components';
import { SchemaRenderer } from '@object-ui/react';
import { useObjectTranslation, useSafeTranslate } from '@object-ui/i18n';
import { AlertCircle, ArrowRight, Copy, Check, RefreshCw, CornerDownLeft, Bot, Eye, GitCompareArrows, Rocket, Clock3, CheckCircle2, ChevronDown, XCircle, Loader2, ShieldCheck, TriangleAlert, ClipboardList, HelpCircle, Info, Table2, WifiOff, Sparkles, Hourglass } from 'lucide-react';
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
import { RecordLinkContext } from './recordLink';
import type { PublishHealth, PublishOutcome } from './publishHealth';
import {
  PromptInput,
  PromptInputBody,
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
  parseResultEnvelope,
  detectAuthoringVerdict,
  detectBuiltAppPackage,
  detectBuildChecklist,
  buildProgressFromDraftReview,
  type BuildResultChecklist,
  type DraftReview,
  type ProposedChanges,
  type ProposedPlan,
  type ProposedPlanCard,
  type ReplayOutcome,
} from './mapMessages';

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
   * Live build progress from a long-running tool (apply_blueprint), lifted from
   * the stream's reconciled `data-build-progress` part. When present, the chat
   * renders a growing "build tree" so the user watches the app take shape
   * instead of staring at a thinking spinner.
   */
  buildProgress?: ChatBuildProgress;
  /**
   * Live blueprint-DESIGN progress from the long, atomic `propose_blueprint`
   * call, lifted from the stream's reconciled `data-blueprint-progress` part.
   * When present, the chat renders a "Designing…" panel whose object chips
   * appear one-by-one — upgrading the purely-presentational rotating-hint
   * placeholder to real, event-driven progress. Transient (never persisted):
   * on reload the authoritative "Proposed plan" card is the record instead.
   */
  blueprintProgress?: ChatBlueprintProgress;
  /**
   * Charts to render inline in the assistant bubble, lifted from the stream's
   * `data-chart` parts (emitted by the `visualize_data` tool via
   * `ctx.onProgress`). Each renders through the platform's SDUI `<chart>`
   * component, so an AI data answer can show a bar/line/pie chart rather than
   * only a wall of text.
   */
  charts?: ChatChart[];
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
 * A build-progress frame's phase: `@objectstack/spec/ai`'s closed
 * `BuildProgressPhase` vocabulary, plus `unknown` for a value outside it, which
 * is surfaced as a warning — never as "Building" (objectui#11988). Spelled out
 * rather than imported so the published typings need no newer spec floor;
 * `buildVerify-11988.test.tsx` asserts at compile time that it equals the
 * spec's union, both ways.
 */
type ChatBuildPhase = 'structure' | 'data' | 'verify' | 'done' | 'unknown';

/** A reconciled snapshot of an in-flight app build (apply_blueprint). */
export interface ChatBuildProgress {
  /** Coarse phase: drafting structure, generating sample data, or finished. */
  phase: ChatBuildPhase;
  /** Human label for the app being built (for the panel header). */
  appLabel?: string;
  /** Artifacts drafted so far, cumulative. */
  items: Array<{ type: string; name: string }>;
  /** Count of artifacts done and the rough total (for the progress bar). */
  done: number;
  total: number;
  /**
   * Monotonic emit counter from the server. Bumps on every progress update —
   * including the keep-alive heartbeats sent during long, quiet seed-generation
   * awaits — so it's the reliable "a fresh byte just arrived" signal the build
   * panel keys its liveness off (content fields stay identical across a
   * heartbeat). Absent from older runtimes.
   */
  seq?: number;
  /**
   * The post-apply verification loop, read from its own `build-verify` part
   * beside the tree (objectui#11988): `verify` while a hop runs, `done` once
   * the loop exits. `hop` and `tool` are the spec frame's own fields.
   */
  verify?: { phase: ChatBuildPhase; hop?: number; tool?: string };
}

/**
 * A reconciled snapshot of an in-flight blueprint DESIGN (`propose_blueprint`).
 * The plan-design step is a long, atomic LLM request; the server now streams a
 * reconciled `data-blueprint-progress` part as the schema takes shape, so the
 * chat can show objects appearing one-by-one instead of a static spinner.
 * Mirrors `ChatBuildProgress` (apply_blueprint's BUILD progress) but for the
 * pre-build PLAN — it is superseded by the authoritative "Proposed plan" card
 * the instant the tool result lands.
 */
export interface ChatBlueprintProgress {
  /**
   * Coarse phase. `designing` while the plan is being drafted; `done` once the
   * authoritative blueprint has arrived (on the `propose_blueprint` tool
   * result). Anything unrecognised — including absent — is treated as designing.
   */
  phase: 'designing' | 'done';
  /** Human one-liner for the app being designed (revealed progressively). */
  summary?: string;
  /** Human label for the new app (absent in extend mode). */
  appLabel?: string;
  /** Extend mode: the existing app the new objects would be added into. */
  targetApp?: string;
  /**
   * Objects surfaced so far, cumulative — they appear one-by-one as the design
   * streams. `fields` is the field count for the chip's "· N" suffix.
   */
  objects: Array<{ name: string; label?: string; fields?: number }>;
  /** Running totals for a compact "N objects · N views · …" line. */
  counts?: { objects?: number; views?: number; dashboards?: number };
  /**
   * Monotonic emit counter from the server — the reliable "a fresh byte just
   * arrived" liveness signal (advances on keep-alive heartbeats too, where the
   * content fields are identical). Absent from older runtimes.
   */
  seq?: number;
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
   * ObjectStack ADR-0033 extension. When a metadata-authoring tool stages a
   * change as a DRAFT, its result carries `{ status: 'drafted', type, name, … }`
   * (or a `drafted: [{type,name}]` batch from `apply_blueprint`). `mapMessages.ts`
   * lifts the reviewable targets here so chat UIs can render a "Review N
   * change(s)" affordance that opens the designer's review/diff. Nothing is
   * live until the human publishes — this is the review entry point.
   *
   * The shape is `mapMessages.ts`'s `DraftReview`, the type `detectDraftResult`
   * returns, referenced rather than repeated: an inline copy of its fields
   * drifted the moment `DraftReview` gained the producer's `kind`
   * (objectui#10109).
   */
  draftReview?: DraftReview;
  /**
   * ObjectStack extension. `propose_blueprint` returns a PLAN before anything
   * is staged (`status: 'blueprint_proposed'`). `mapMessages.ts` lifts the
   * reviewable shape here so chat UIs can render a "Proposed plan" card — the
   * objects the build will create, the agent's assumptions, and any
   * structure-deciding questions — and the user can approve or adjust before
   * `apply_blueprint` runs. Nothing is created yet; this is the confirm gate.
   *
   * The shape is `mapMessages.ts`'s `ProposedPlan`, referenced rather than
   * repeated, for the reason `draftReview` above gives (objectui#12724 added
   * the field, view and app-label rows to it).
   */
  proposedPlan?: ProposedPlan;
  /** Granular metadata-change preview (confirm-before-change). Set only
   *  when a mutating tool returned status:'changes_proposed' — i.e. it was
   *  NOT yet approved this turn, so nothing changed. Rendered as a 确认修改 card.
   *
   *  The shape is `mapMessages.ts`'s `ProposedChanges`, the type
   *  `detectProposedChanges` returns, referenced rather than repeated for the
   *  reason `draftReview` above gives (objectui#12894 added the posture and
   *  the primary action to it). */
  proposedChanges?: ProposedChanges;
  /**
   * ADR-0057 P4 — the `ask` agent's structured decline-and-redirect. Set when
   * the ask agent called `suggest_builder` (`{ handoff:'build', prompt,
   * packageId? }`) because the user asked to author. `mapMessages.ts` lifts the
   * handoff here so the chat renders an explicit "Open in Builder →" action that
   * opens the build surface seeded with `prompt` — never a silent re-route into
   * authoring (ADR-0063).
   */
  builderHandoff?: {
    prompt: string;
    packageId?: string;
  };
  /**
   * cloud#1658 — the ask agent's `open_record` structured hand-off (the record
   * sibling of `builderHandoff`). Rendered as a "打开这条记录 →" action landing
   * on the record the agent already resolved.
   */
  recordHandoff?: {
    objectName: string;
    recordId: string;
    label?: string;
    reason?: string;
  };
  /**
   * objectui#5695 — the terminal verdict of a confirm-replay (`replay_<id>`
   * tool results; cloud `runApprovedProposalReplay`). Rendered as a terminal
   * state on the ORIGINAL 确认修改 card — 已生效 / 已暂存为草稿 / 未生效 — so a
   * rolled-back publish exists somewhere a USER can see it, independent of
   * whether the model narrates it honestly.
   *
   * The shape is `mapMessages.ts`'s `ReplayOutcome`, referenced rather than
   * repeated (objectui#12894 added the applied card of a change saved as a
   * draft to it).
   */
  replayOutcome?: ReplayOutcome;
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
  /**
   * Lead-in shown while the build agent is designing a plan (the long, atomic
   * `propose_blueprint` call) — e.g. "Designing your app…". Pairs with the live
   * timer so the wait reads as deliberate work, not a hang.
   */
  designingPlanLabel?: string;
  /**
   * Rotating "what I'm doing now" hints cycled through during that same
   * propose_blueprint wait (the call is a single atomic LLM request with no
   * partial stream, so these are presentational reassurance, not live status).
   * Defaults to a sensible English set when omitted; pass a localized list to
   * override. An empty array disables rotation (only `designingPlanLabel` shows).
   */
  designingPlanHints?: string[];
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
   * cards (proposed-plan, drafts) still render — but their action buttons
   * stay hidden because the host passes no `onSendMessage`/`onPublishDrafts`
   * callbacks, so the cards degrade to their read-only/summary form.
   */
  readOnly?: boolean;
  /**
   * Whether the assistant is currently generating a response. While it is
   * true the proposed-plan card's actions are disabled as well
   * (objectui#10925), so a click cannot send the next turn while this one is
   * still streaming.
   */
  isLoading?: boolean;
  /** Current streaming/API error */
  error?: Error;
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
   * When provided, tool parts whose result drafted metadata (ADR-0033) render a
   * "Review N change(s)" button inside their body. The callback receives the
   * reviewable `{ type, name }` targets; the host typically navigates to the
   * designer's review/diff. See `ChatbotEnhancedToolInvocation.draftReview`.
   */
  onReviewDraft?: (items: Array<{ type: string; name: string }>) => void;
  /** Label for the review-draft button (default "Review {n} change(s)"). */
  toolReviewLabel?: (count: number) => string;
  /**
   * When provided AND the drafted tool result reported its owning `packageId`,
   * tool parts render a one-click "Publish" button so the human can promote the
   * staged drafts to live without leaving the conversation (the ADR-0033 gate
   * stays — the human still clicks). The host wires this to
   * `POST /api/v1/packages/:packageId/publish-drafts`.
   *
   * Return value (all forms accepted, `false`/`{ok:false}` = failure):
   * - `boolean | void` — legacy success flag;
   * - `{ ok: boolean; health?: PublishHealth }` — ADR-0038 L3: the publish
   *   response's `seedApplied` + runtime `probes`, rendered as a build-health
   *   line under the Published badge so "Published" and "actually works" are
   *   two separately-verified statements.
   */
  onPublishDrafts?: (
    packageId: string,
  ) => void | boolean | PublishOutcome | Promise<void | boolean | PublishOutcome>;
  /**
   * objectui#12894 — 查看变更并发布 on the applied card of a change the copilot
   * saved as a draft (cloud#2924): open the host's review of the package's
   * pending drafts (Studio's 变更), where the user checks them and publishes.
   * Absent, the applied card keeps the inline Publish button `onPublishDrafts`
   * draws, as before.
   */
  onReviewDrafts?: (packageId: string) => void;
  /**
   * objectui#12894 — 撤销 on the same applied card. The host wires it to
   * `POST /api/v1/packages/:packageId/discard-drafts`, which discards EVERY
   * pending draft of the package, not only this change's; the card says so,
   * and asks first, whenever other drafts are pending (`draftState.others`, or
   * the live count from `fetchPendingDraftCount` when the host gives one).
   * Return `false` / `{ ok: false, error? }` on failure; any other outcome
   * (incl. void) counts as done. Absent, no 撤销 is drawn.
   */
  onDiscardDrafts?: (
    packageId: string,
  ) =>
    | void
    | boolean
    | { ok: boolean; error?: string }
    | Promise<void | boolean | { ok: boolean; error?: string }>;
  /**
   * When provided, a finished build tree (`buildProgress.phase === 'done'`) that
   * created an `app` renders an "Open app" action so the user can jump straight
   * into what was just built. The host wires this to its router (e.g.
   * `navigate('/apps/<name>')`).
   */
  onOpenBuiltApp?: (appName: string, appSegment?: string) => void;
  /** Label for the open-built-app action (default "Open app"). */
  openBuiltAppLabel?: string;
  /**
   * When provided, a finished build that created an `app` renders a "Design in
   * Studio" action (the console's 在 Studio 中查看). Beside `onOpenBuiltApp` it is
   * the SECONDARY action — "Open app" (打开应用) is primary (objectui#12724);
   * without `onOpenBuiltApp` it takes the primary slot. The host wires this to
   * its Studio route (e.g. `navigate('/studio/<pkg>/interfaces')`).
   */
  onDesignBuiltApp?: (appName: string, appSegment?: string) => void;
  /** Label for the design-built-app action (default "Design in Studio"). */
  designBuiltAppLabel?: string;
  /**
   * Deep-link a built artifact to where it can be edited directly (its Studio
   * pillar). Called per artifact row with the owning package id (from the
   * build's own draft envelope, so reloaded conversations link too); return
   * the click action for a linkable artifact, or null to render it as plain
   * text — the host decides which types have a direct-edit home (e.g.
   * object → Data, flow → Automations).
   */
  getArtifactAction?: (
    artifact: { type: string; name: string },
    appSegment?: string,
  ) => (() => void) | null;
  /**
   * ADR-0037 Live Canvas: preview the drafted app *before* it is published.
   * Rendered next to the build tree's Open-app action and on draft chips
   * whose items include an `app`. The host wires this to its router with the
   * preview flag (e.g. `navigate('/apps/<name>?preview=draft')`).
   * ADR-0045: when the build reports `materialized`, `opts.materialized` is
   * true and the host should open the REAL app URL (no preview flag) — the
   * app is live-but-unlisted, with actual tables and seed data.
   */
  onPreviewDraftApp?: (
    appName: string,
    opts?: { materialized?: boolean; appSegment?: string },
  ) => void;
  /** Label for the preview-draft action (default "Preview"). */
  previewDraftLabel?: string;
  /**
   * objectui#12968 (objectstack#24324 ruling A, preview-first) — preview ANY
   * drafted result, not only a drafted app. When provided, a drafted tool
   * result whose items include no `app` and whose owning `packageId` is known
   * renders a Preview button beside Publish and Review; the click hands the
   * host the drafted `{ type, name }` items and the package id as the app's
   * route segment (ADR-0048). The host resolves the affected surface (a page,
   * the object's list on a view, the object's default list) and opens it in
   * draft preview (`?preview=draft`). A draft set that includes an app keeps
   * {@link ChatbotEnhancedProps.onPreviewDraftApp}, unchanged. The applied
   * card of a confirmed change saved as a draft (a `drafted` replay outcome)
   * draws the same Preview over the items that change drafted. Preview never
   * publishes: publish stays the human gate (ADR-0033).
   */
  onPreviewDraft?: (
    items: Array<{ type: string; name: string }>,
    opts: { appSegment: string },
  ) => void;
  /**
   * ADR-0037 Live Canvas: notifies the host whenever AI-authored draft
   * artifacts land in the conversation (build-progress items + drafted
   * envelopes), with the cumulative deduped set. Hosts use it to open and
   * refresh the live draft-preview pane while the agent builds.
   */
  onDraftArtifacts?: (
    artifacts: Array<{ type: string; name: string }>,
    appSegment?: string,
  ) => void;
  /**
   * ADR-0045: fires once per build whose tool result reports `materialized`
   * with an `app` in the draft set — the app is live (tables + seed data)
   * but unlisted. Hosts switch the canvas to the real app URL.
   */
  onBuildMaterialized?: (appName: string) => void;
  /**
   * objectui#11666 — reports whether this thread's NEWEST proposed plan is
   * still waiting for the user's approval: its card offers "Build it", i.e.
   * {@link resolveProposalCardState} reads `pending` for it. Fires once on
   * mount and again on every change of that boolean. An earlier plan does not
   * count once a newer one exists (the newer card is the one awaiting); an
   * approval (the optimistic "Building…" flip) or a build that ran ends it.
   * Hosts mirror it outside the chat — the console's launchers show a marker
   * while the chat is closed.
   */
  onPlanApprovalPendingChange?: (pending: boolean) => void;
  /**
   * ADR-0057 P4 — invoked when the user clicks "Open in Builder →" on an `ask`
   * agent's `suggest_builder` decline. The host opens the build surface seeded
   * with the handoff prompt/package (never a silent re-route; ADR-0063). Absent
   * → the button is disabled (nothing to route to).
   */
  onOpenBuilder?: (handoff: { prompt: string; packageId?: string }) => void;
  /** cloud#1658 — open the record an `open_record` hand-off points at. */
  onOpenRecord?: (handoff: { objectName: string; recordId: string; label?: string; reason?: string }) => void;
  /** Heading for the ADR-0057 P4 "Open in Builder" handoff card (default "Build this in the Builder"). */
  builderHandoffTitleLabel?: string;
  /** Label for the handoff card's primary action button (default "Open in Builder →"). */
  builderHandoffOpenLabel?: string;
  /** Tooltip on a superseded (older) handoff card's disabled button (default "A newer request is available"). */
  builderHandoffSupersededTitle?: string;
  /** cloud#1658 — the record hand-off card's title. */
  recordHandoffTitleLabel?: string;
  /** cloud#1658 — the record hand-off card's action label. */
  recordHandoffOpenLabel?: string;
  /** Label for the publish-drafts button (default "Publish"). */
  publishDraftsLabel?: string;
  /** Label for the published-state badge that replaces the button (default "Published"). */
  publishedLabel?: string;
  /** Label for the clean ADR-0038 verification chip (default "Verified"). */
  verifiedLabel?: string;
  /** Heading for the post-build "what's next" checklist (default "What's next"). */
  nextStepsLabel?: string;
  /** Heading for the pre-build proposed-plan card (default "Proposed plan"). */
  planTitleLabel?: string;
  /** Extend mode: host override for the scope chip's prefix, shown before the
   *  target app as `PREFIX "APP"` when proposedPlan.targetApp is set. Omitted,
   *  the chip reads the localized `chatbot.plan.extendTarget` sentence — the
   *  component carries no English default of its own (objectui#11658). */
  planExtendLabel?: string;
  /** objectui#11658 — the display label of an existing app, by its machine
   *  name. The extend-mode scope chip names the target app with it; the
   *  internal name stays on the chip's tooltip. `undefined` (or a resolver that
   *  does not know the app) shows the name as given. */
  resolveAppLabel?: (appName: string) => string | undefined;
  /** Heading above the structure-deciding questions in the plan card (default "Confirm before building"). */
  planQuestionsLabel?: string;
  /** Heading above the agent's assumptions in the plan card (default "Assumptions"). */
  planAssumptionsLabel?: string;
  /**
   * Heading for the distinct "not yet built" section of the plan card — the
   * assumptions that name a business rule the build is explicitly DEFERRING to a
   * later flow/permission/approval pass (default "Not yet built"). Surfaced apart
   * from ordinary assumptions so the user does not mistake a deferred rule for
   * delivered behaviour (improvement 2). Split heuristically by
   * `classifyAssumptions`; the section only appears when something is deferred. */
  planDeferredLabel?: string;
  /** Footer hint inviting the user to approve or adjust the plan (default "Reply to approve or adjust this plan."). Shown only when `onSendMessage` is absent (no one-click gate). */
  planApproveHintLabel?: string;
  /** Label for the plan card's primary one-click "build it" button (default "Build it"). */
  planApproveLabel?: string;
  /** Label for the plan card's secondary "adjust" button, which focuses the chat input (default "Adjust"). */
  planAdjustLabel?: string;
  /** Static badge shown in place of the "Build it" button once this plan's build has run, so it can't be re-triggered (default "Built"). */
  planBuiltLabel?: string;
  /** Badge shown on a plan card right after its Build-it was clicked (#2627). */
  planBuildingLabel?: string;
  /**
   * Body line of the FALLBACK confirm card shown when a propose_blueprint step
   * finished but produced no structured plan (so the rich card can't render).
   * The "Build it"/"Adjust" buttons (reusing `planApproveLabel`/`planAdjustLabel`)
   * still appear, so the user never has to guess the confirmation phrase
   * (default "The plan is ready. Build it now, or tell me what to adjust."). */
  planReadyLabel?: string;
  /** Message sent when the user approves a plan with no open questions (default "Looks good — build it as proposed."). */
  planApproveMessage?: string;
  /** Message sent when the user approves a plan that still has open questions — tells the agent to proceed on sensible defaults (default "Build it with your best assumptions; use sensible defaults for the open questions."). */
  planApproveDefaultsMessage?: string;
  /**
   * Builds the message sent when the user clicks a one-click answer chip for a
   * structure-deciding question (from `proposedPlan.questionChoices`). Receives
   * the question text and the chosen option. Default:
   * `For "<question>", go with: <option>.` — answers that question and lets the
   * agent continue (ask the next question or build).
   */
  planAnswerMessage?: (question: string, option: string) => string;
  /**
   * Labels for the granular confirm-before-change card (`changes_proposed`).
   * Separate from the plan card's: that one approves a whole build, this one
   * approves a specific set of metadata edits. They were hard-coded Chinese
   * until objectui#2884, so an English user read them in Chinese.
   */
  /** Heading of the confirm-before-change card (default "Confirm changes"). */
  changesTitleLabel?: string;
  /** Badge replacing the buttons once this change set has been confirmed (default "Confirmed"). */
  changesConfirmedLabel?: string;
  /** Label for the card's primary confirm button (default "Confirm"). */
  changesConfirmLabel?: string;
  /** Footer hint shown when `onSendMessage` is absent, so there is no one-click gate (default "Reply to confirm or adjust this change."). */
  changesConfirmHintLabel?: string;
  /**
   * Message sent to the agent when the user confirms the change set. Like
   * `planApproveMessage` this is OUTBOUND text, so the console picks it by the
   * language of the CONVERSATION, not of the UI — sending Chinese from an
   * English session would flip the agent's reply language (objectui#2884).
   * The wording must satisfy the cloud confirm gate's approval pattern or the
   * agent re-proposes and the button looks inert.
   * Default "Confirm — apply the change you just proposed."
   */
  changesConfirmMessage?: string;
  /**
   * Display names for the change verbs rendered in each row of that card
   * (`create_object`, `add_field`, …). Falls back to the raw verb for any key
   * not supplied, so an unrecognised server-side verb still renders.
   */
  changeVerbLabels?: Record<string, string>;
  /** In-flight badge while the confirm-replay is applying (default "Applying…"). objectui#5695. */
  changesApplyingLabel?: string;
  /** Terminal badge when the replay published the change (default "Applied"). */
  changesAppliedLabel?: string;
  /** Terminal badge when the replay staged a draft (default "Saved as draft"). */
  changesDraftedLabel?: string;
  /** Terminal badge when the replay's publish did not go live (default "Not applied"). */
  changesFailedLabel?: string;
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
   * Live draft-status resolver: how many drafts are still PENDING in a
   * package (e.g. `GET /metadata/_drafts?packageId=` count). When provided,
   * each draft card's Publish/Published affordance reflects the SERVER's
   * current state instead of this component's in-memory publish history —
   * so a reloaded conversation shows "Published" for work that went live,
   * and a card whose package gained new drafts offers Publish again. The
   * in-memory snapshot remains the fallback when the prop is absent.
   */
  fetchPendingDraftCount?: (packageId: string) => Promise<number>;
  /**
   * Auto-fire `onPublishDrafts` the moment a turn finishes drafting an app —
   * the self-use "magic moment" where the user refreshes and the app is already
   * live WITH data, instead of clicking Publish. Server-gated by the plan
   * (`features.autoPublishAiBuilds`, env-revertible via
   * `OS_AI_AUTOPUBLISH_DISABLED`); the host passes the resolved flag.
   *
   * Only NEW drafts from the current session fire — drafts already present when
   * the chat mounts (e.g. reopening a conversation) are left for the manual
   * Publish button, so reopening history never silently publishes.
   *
   * @default false
   */
  autoPublishDrafts?: boolean;
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

// Moved to the side-effect-free `./publishHealth` so `@object-ui/plugin-chatbot/core`
// can serve it without this module (objectui#13410); re-exported unchanged.
export { publishHealthFromResponse } from './publishHealth';
export type { PublishHealth, PublishOutcome } from './publishHealth';

export type ToolDecisionState =
  | { state: 'pending'; message?: string }
  | { state: 'success'; message?: string }
  | { state: 'error'; message: string };

export interface ChatbotModelOption {
  id: string;
  label?: string;
  provider?: string;
}

/** The item a selected model none of the offered models carries is shown by. */
const OUTSIDE_MODELS = 'outside';

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
 */
function ModelPicker({
  label,
  models,
  value,
  onPick,
}: {
  label: string;
  models: ReadonlyArray<ChatbotModelOption>;
  value: string;
  onPick: (modelId: string) => void;
}) {
  const at = models.findIndex((m) => m.id === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_MODELS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the host's own model, so there is nothing to write.
        const picked = models[Number(token)];
        if (picked) onPick(picked.id);
      }}
    >
      <SelectTrigger
        aria-label={label}
        className="h-7 w-auto gap-1 px-2 text-xs text-muted-foreground hover:text-foreground focus:ring-1 focus:ring-offset-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_MODELS}>{value}</SelectItem>}
        {models.map((m, i) => (
          <SelectItem key={`${i}:${m.id}`} value={String(i)}>
            {m.label ?? m.id}
            {m.provider ? ` · ${m.provider}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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

/**
 * The tool RETURNED, but its result is a confirm-before-change PREVIEW — the
 * change was proposed, NOT applied. Detects the gate envelopes
 * (`changes_proposed` from granular edits, `blueprint_proposed` /
 * `awaiting_confirmation` from the build flow). #772: without this a proposed
 * edit's activity chip read "Completed" even though it was still waiting for
 * the user to confirm.
 *
 * Uses the shared `parseResultEnvelope` so it peels the Vercel AI SDK tool
 * output shell `{ type:'text', value:'<json>' }` before reading `.status` —
 * the real `tool.result` is that wrapped shell, not a bare object/string, so a
 * hand-rolled `.status` check (which only saw the shell) always returned false
 * and the collapsed header stayed "Completed" instead of "Awaiting Approval"
 * (#787 finding B / #2362).
 */
export function isProposalResult(result: unknown): boolean {
  const status = parseResultEnvelope(result)?.status;
  return (
    status === 'changes_proposed' ||
    status === 'blueprint_proposed' ||
    status === 'awaiting_confirmation'
  );
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
    // A returned-but-not-applied confirm preview is AWAITING the user, not done
    // (#772): the change only commits when they approve on the next turn.
    return isProposalResult(tool.result) ? 'awaiting' : 'completed';
  }
  return 'running';
}

/**
 * How far a confirm-gate proposal card has actually got — the SINGLE producer
 * of that fact (objectui#7254).
 *
 * The card BODY already renders a terminal badge from four separate memos:
 * `builtPlanIds` (已搭建), `approvedPlanIds` (building), `confirmedChangeIds`
 * (已确认) and `replayOutcomeByProposalId` (已生效 / 已暂存为草稿 / 未生效).
 * The HEADER badge read none of them: it derived from `isProposalResult(result)`
 * alone, which is a fact about the tool's *own* output and never changes once
 * the tool has returned. So a card whose body said 已搭建 / 已生效 kept a header
 * reading "Awaiting Approval" forever — the same class of divergence recorded on
 * cloud#787, mirrored. Fixing it in the header's own branch would have made a
 * FIFTH producer of the same fact; this function is the one both sides read.
 *
 * Precedence is "what actually happened" over "what was asked for": a replay
 * verdict is the server's own answer and outranks the positional heuristics,
 * and `built`/`confirmed` (a later commit was observed in the stream) outrank
 * `approved` (the user clicked, nothing has landed yet).
 */
export type ProposalCardState = 'pending' | 'in-progress' | 'settled' | 'failed';

export function resolveProposalCardState(input: {
  /** A replay verdict for this proposal, when one has arrived. */
  replayOutcome?: { kind: 'published' | 'drafted' | 'failed' | 'applying' };
  /** An `apply_blueprint` ran after this plan card (`builtPlanIds`). */
  built?: boolean;
  /** A later same-tool commit followed this proposal (`confirmedChangeIds`). */
  confirmed?: boolean;
  /** The user approved, but no result has come back yet (`approvedPlanIds`). */
  approved?: boolean;
}): ProposalCardState {
  const kind = input.replayOutcome?.kind;
  if (kind === 'failed') return 'failed';
  if (kind === 'published' || kind === 'drafted') return 'settled';
  if (kind === 'applying') return 'in-progress';
  if (input.built || input.confirmed) return 'settled';
  if (input.approved) return 'in-progress';
  return 'pending';
}

/**
 * The header badge state each {@link ProposalCardState} maps to. Kept as a
 * table rather than a chain so the header can never grow a fifth state the
 * body does not have.
 */
const PROPOSAL_HEADER_STATE: Record<
  ProposalCardState,
  NonNullable<ChatbotEnhancedToolInvocation['state']>
> = {
  pending: 'approval-requested',
  'in-progress': 'input-available',
  settled: 'output-available',
  failed: 'output-error',
};

/**
 * English display names for the change verbs. Overridable per-consumer via the
 * `changeVerbLabels` prop — the console passes the translated set. These were
 * hard-coded Chinese until objectui#2884.
 */
const DEFAULT_CHANGE_VERB_LABELS: Record<string, string> = {
  create_object: 'Create object',
  add_field: 'Add field',
  modify_field: 'Modify field',
  delete_field: 'Delete field',
  create_metadata: 'Create',
  update_metadata: 'Modify',
  create_seed: 'Generate sample data',
  create_package: 'Create app package',
};

/** Render one granular change descriptor as a readable line for the confirm card. */
function formatChangeRow(
  c: {
    verb: string;
    object?: string;
    field?: string;
    type?: string;
    name?: string;
    details?: string;
  },
  verbLabels: Record<string, string> = DEFAULT_CHANGE_VERB_LABELS,
): string {
  const verb = verbLabels[c.verb] ?? DEFAULT_CHANGE_VERB_LABELS[c.verb] ?? c.verb;
  const target = c.field ? `${c.object ? `${c.object}.` : ''}${c.field}` : (c.object ?? c.name ?? '');
  const typePart = c.type ? ` (${c.type})` : '';
  return [verb, `${target}${typePart}`, c.details].filter(Boolean).join(' ');
}

/**
 * objectui#12894 — where 撤销 stands on one applied card: asking first (with
 * the pending counts it can name), running, done, or refused by the host.
 */
type DraftDiscardState =
  | { phase: 'confirm'; others?: number; total?: number }
  | { phase: 'running' }
  | { phase: 'done' }
  | { phase: 'failed'; error?: string };

/**
 * objectui#12894 — the change card draws v2 when the envelope carries
 * cloud#2924's posture (`posture` / `primaryAction`, which the producer sends
 * together). An older cloud, or an environment that does not publish AI
 * changes in the turn, sends neither, and the card draws as before.
 */
function isChangePlanV2(changes: ProposedChanges): boolean {
  return changes.posture !== undefined || changes.primaryAction !== undefined;
}

type ChangeRow = ProposedChanges['changes'][number];
type ChangeFace = 'add' | 'modify' | 'remove';

/** What a row does to the app, by its verb: ＋ adds, ✎ changes, － removes. */
function changeFaceOf(verb: string): ChangeFace {
  if (verb === 'delete_field') return 'remove';
  if (verb === 'add_field' || verb.startsWith('create_')) return 'add';
  return 'modify';
}

const CHANGE_FACE_SYMBOL: Record<ChangeFace, string> = { add: '＋', modify: '✎', remove: '－' };
const CHANGE_FACE_CLASS: Record<ChangeFace, string> = {
  add: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  modify: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  remove: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

/**
 * objectui#12894 — the kind a change row names (字段 / 视图 / 对象 …), through the
 * pack. A STATIC switch for the reason `useBuildGroupLabel` gives: a computed
 * key is invisible to `check-i18n-call-site-keys`. A metadata row names its
 * `type`; a type the pack has no word for renders as its machine name, and a
 * verb no arm knows renders as its verb label, as the v1 row did.
 */
function useChangeKindLabel(verbLabels: Record<string, string>): (c: ChangeRow) => string {
  const { t } = useObjectTranslation();
  return React.useCallback(
    (c: ChangeRow) => {
      const kindOfType = (type: string | undefined): string | undefined => {
        switch (type) {
          case 'object':
            return t('chatbot.changes.kind.object', { defaultValue: 'Object' });
          case 'view':
            return t('chatbot.changes.kind.view', { defaultValue: 'View' });
          case 'dashboard':
            return t('chatbot.changes.kind.dashboard', { defaultValue: 'Dashboard' });
          case 'app':
            return t('chatbot.changes.kind.app', { defaultValue: 'App' });
          default:
            return type;
        }
      };
      switch (c.verb) {
        case 'add_field':
        case 'modify_field':
        case 'delete_field':
          return t('chatbot.changes.kind.field', { defaultValue: 'Field' });
        case 'create_object':
          return kindOfType('object')!;
        case 'create_seed':
          return t('chatbot.changes.kind.seed', { defaultValue: 'Sample data' });
        case 'create_package':
          return t('chatbot.changes.kind.package', { defaultValue: 'App package' });
        case 'create_metadata':
        case 'update_metadata': {
          const kind = kindOfType(c.type);
          if (kind) return kind;
          break;
        }
        default:
          break;
      }
      return verbLabels[c.verb] ?? DEFAULT_CHANGE_VERB_LABELS[c.verb] ?? c.verb;
    },
    [t, verbLabels],
  );
}

/**
 * objectui#12894 — the change card v2's body (the StudioRailCopilot artboard):
 * 「修改方案 · N 项」, one row per change — the ＋ / ✎ / － symbol, the kind,
 * `object · field` (the producer sends machine names only), and in small type
 * the field type and the row's `details` (label · default · required) — then
 * the posture note. When the change will be saved as a draft (`posture.mode:
 * 'draft'`) the note is the producer's `summary`, drawn in amber; otherwise the
 * summary reads as plain text.
 */
function ChangePlanBody({
  changes,
  verbLabels,
}: {
  changes: ProposedChanges;
  verbLabels: Record<string, string>;
}) {
  const { t } = useObjectTranslation();
  const kindOf = useChangeKindLabel(verbLabels);
  const count = changes.changes.length;
  return (
    <>
      <span
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground"
        data-testid="proposed-changes-title"
      >
        <ClipboardList className="size-3.5 text-foreground/60" />
        {t('chatbot.changes.planTitle', { count, defaultValue: 'Change plan · {{count}} changes' })}
      </span>
      <div className="flex flex-col" data-testid="proposed-changes-rows">
        {changes.changes.map((c, idx) => {
          const face = changeFaceOf(c.verb);
          const target = c.field
            ? c.object
              ? `${c.object} · ${c.field}`
              : c.field
            : (c.name ?? c.object ?? '');
          const params = [c.type, c.details].filter(Boolean).join(' · ');
          return (
            <div
              key={idx}
              className="flex items-start gap-2 border-t border-border/60 py-1.5 first-of-type:border-t-0"
              data-testid="proposed-change-row"
              data-change={face}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'inline-flex size-[18px] shrink-0 items-center justify-center rounded text-xs font-bold',
                  CHANGE_FACE_CLASS[face],
                )}
                data-testid="proposed-change-symbol"
              >
                {CHANGE_FACE_SYMBOL[face]}
              </span>
              <span className="sr-only">
                {verbLabels[c.verb] ?? DEFAULT_CHANGE_VERB_LABELS[c.verb] ?? c.verb}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-xs text-foreground/90">
                  <strong className="font-medium" data-testid="proposed-change-kind">
                    {kindOf(c)}
                  </strong>{' '}
                  <span className="break-all" data-testid="proposed-change-target">
                    {target}
                  </span>
                </span>
                {params ? (
                  <span
                    className="break-words font-mono text-[11px] text-muted-foreground"
                    data-testid="proposed-change-params"
                  >
                    {params}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {changes.summary ? (
        changes.posture?.mode === 'draft' ? (
          <div
            className="flex gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
            data-testid="proposed-changes-posture-note"
            data-posture="draft"
          >
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{changes.summary}</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="proposed-changes-summary">
            {changes.summary}
          </p>
        )
      ) : null}
    </>
  );
}

/**
 * objectui#12968 (objectstack#24324 ruling A) — the one rule for what a
 * drafted set's Preview opens, shared by the drafted result and the
 * confirm-gated applied card. A set that includes an app previews the app
 * (`onPreviewDraftApp`, the Live Canvas's whole-app preview); any other set
 * previews its items through `onPreviewDraft`, which needs the owning package
 * id as the app's route segment (ADR-0048). `undefined` when the host wired
 * neither door the set needs, or the set is empty.
 */
function draftPreviewAction(
  items: ReadonlyArray<{ type: string; name: string }>,
  packageId: string | undefined,
  materialized: boolean,
  doors: Pick<ChatbotEnhancedProps, 'onPreviewDraftApp' | 'onPreviewDraft'>,
): { run: () => void; app: boolean } | undefined {
  if (items.length === 0) return undefined;
  const app = items.find((i) => i.type === 'app');
  if (app) {
    const open = doors.onPreviewDraftApp;
    return open ? { run: () => open(app.name, { materialized, appSegment: packageId }), app: true } : undefined;
  }
  const open = doors.onPreviewDraft;
  return open && packageId ? { run: () => open([...items], { appSegment: packageId }), app: false } : undefined;
}

/**
 * objectui#12894 — the applied card of a change the copilot saved as a draft
 * (cloud#2924, the StudioRailCopilot artboard): `appliedCard.title` beside a
 * tick, its `lines`, then 查看变更并发布 (the host's review of the package's
 * pending drafts) and 撤销. Without a review door the inline Publish button
 * stays in its place, as the drafted badge drew it before.
 *
 * 撤销 runs a door that discards every pending draft of the package. When
 * `draftState.others` says other drafts are pending, the button says so; the
 * confirm the parent opens names the counts before anything runs.
 */
function AppliedDraftCard({
  card,
  others,
  discard,
  onPreview,
  previewLabel,
  onReview,
  onPublish,
  publishLabel,
  onDiscard,
  onDiscardConfirm,
  onDiscardCancel,
}: {
  card: NonNullable<ReplayOutcome['appliedCard']>;
  others?: number;
  discard?: DraftDiscardState;
  /** objectui#12968 — preview what the change drafted (the host's `onPreviewDraft`). */
  onPreview?: () => void;
  previewLabel: string;
  onReview?: () => void;
  onPublish?: () => void;
  publishLabel: string;
  onDiscard?: () => void;
  onDiscardConfirm?: () => void;
  onDiscardCancel: () => void;
}) {
  const { t } = useObjectTranslation();
  const done = discard?.phase === 'done';
  const running = discard?.phase === 'running';
  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border bg-background px-2.5 py-2"
      data-testid="applied-card"
    >
      <span
        className={cn(
          'inline-flex items-center gap-2 text-xs font-semibold',
          done ? 'text-muted-foreground line-through' : 'text-foreground',
        )}
        data-testid="applied-card-title"
      >
        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
        </span>
        {card.title}
      </span>
      {card.lines.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground" data-testid="applied-card-lines">
          {card.lines.map((line, idx) => (
            <li key={idx} data-testid="applied-card-line">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {done ? (
        <span
          className="inline-flex h-7 w-fit items-center gap-1.5 rounded-md border bg-muted/40 px-3 text-xs font-medium text-foreground/70"
          data-testid="applied-card-discarded"
        >
          <CheckCircle2 className="size-3.5" />
          {t('chatbot.changes.undone', { defaultValue: 'Undone' })}
        </span>
      ) : discard?.phase === 'confirm' ? (
        <div
          className="flex flex-col gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
          role="alert"
          data-testid="applied-card-discard-confirm"
        >
          <span data-testid="applied-card-discard-confirm-text">
            {discard.others !== undefined && discard.total !== undefined
              ? t('chatbot.changes.undoConfirm', {
                  count: discard.others,
                  total: discard.total,
                  defaultValue:
                    'Undo discards all {{total}} unpublished drafts of this package, including {{count}} that are not part of this change.',
                })
              : t('chatbot.changes.undoConfirmUnknown', {
                  defaultValue: 'Undo discards every unpublished draft of this package, not only this change.',
                })}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onDiscardConfirm}
              className="inline-flex h-7 items-center rounded-md bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
              data-testid="applied-card-discard-confirm-run"
            >
              {t('chatbot.changes.undoConfirmAction', { defaultValue: 'Undo all' })}
            </button>
            <button
              type="button"
              onClick={onDiscardCancel}
              className="inline-flex h-7 items-center rounded-md border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
              data-testid="applied-card-discard-cancel"
            >
              {t('chatbot.changes.undoCancel', { defaultValue: 'Cancel' })}
            </button>
          </div>
        </div>
      ) : (
        <>
          {onReview || onPublish || onPreview || onDiscard ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="proposed-changes-actions">
              {onReview ? (
                <button
                  type="button"
                  onClick={onReview}
                  disabled={running}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="applied-card-review"
                >
                  <GitCompareArrows className="size-3.5" />
                  {t('chatbot.changes.reviewAndPublish', { defaultValue: 'Review changes and publish' })}
                </button>
              ) : onPublish ? (
                <button
                  type="button"
                  onClick={onPublish}
                  disabled={running}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="proposed-changes-publish"
                >
                  <Rocket className="size-3.5" />
                  {publishLabel}
                </button>
              ) : null}
              {onPreview ? (
                <button
                  type="button"
                  onClick={onPreview}
                  disabled={running}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="applied-card-preview"
                >
                  <Eye className="size-3.5" />
                  {previewLabel}
                </button>
              ) : null}
              {onDiscard ? (
                <button
                  type="button"
                  onClick={onDiscard}
                  disabled={running}
                  className="inline-flex h-7 items-center rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="applied-card-discard"
                >
                  {running
                    ? t('chatbot.changes.undoing', { defaultValue: 'Undoing…' })
                    : others !== undefined && others > 0
                      ? t('chatbot.changes.undoWithOthers', {
                          count: others,
                          defaultValue: 'Undo (and {{count}} other drafts)',
                        })
                      : t('chatbot.changes.undo', { defaultValue: 'Undo' })}
                </button>
              ) : null}
            </div>
          ) : null}
          {discard?.phase === 'failed' ? (
            <span
              className="flex flex-col text-[11px] text-red-700/80 dark:text-red-300/80"
              role="alert"
              data-testid="applied-card-discard-failed"
            >
              <span>{t('chatbot.changes.undoFailed', { defaultValue: 'Undo failed' })}</span>
              {discard.error ? <span>{discard.error}</span> : null}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * True when this tool is the build agent's "propose a plan" step
 * (`propose_blueprint`). Matched by name so we can recognise it even when its
 * result did NOT parse into a structured `proposedPlan` — the case that used to
 * leave the user with a bare "reply 确认 to build" text and no button.
 */
function isBuildProposalTool(tool: ChatbotEnhancedToolInvocation): boolean {
  return tool.toolName === 'propose_blueprint';
}

/**
 * A COMPLETED propose_blueprint whose result the detector could not turn into a
 * rich `proposedPlan` card (e.g. the model returned a thin/oddly-shaped envelope,
 * or proposed in prose). We still owe the user an explicit confirm gate, so the
 * detailed body renders a minimal "ready to build — Build it / Adjust" card
 * instead of collapsing the step into a chip and forcing them to guess the magic
 * "确认" phrase. Only the finished, non-error state qualifies: a running proposal
 * keeps its live timer, an errored one keeps its error card.
 */
function isUnstructuredBuildProposal(tool: ChatbotEnhancedToolInvocation): boolean {
  return (
    isBuildProposalTool(tool) &&
    getToolState(tool) === 'completed' &&
    !tool.proposedPlan &&
    !tool.proposedChanges &&
    !tool.draftReview?.items.length
  );
}

/**
 * Phrases (Chinese + English, case-insensitive) that mark a plan `assumption` as
 * a business rule the build will NOT implement THIS turn — it is explicitly left
 * for a later flow/permission/approval pass. These read as "…will be added
 * later" / "…需要后续单独补权限" rather than a design note about what the build
 * already does, and the user must not mistake them for delivered behaviour.
 *
 * Kept deliberately conservative: only an explicit deferral marker matches. A
 * neutral design note (e.g. "设备通过所属客户建立归属关系") has none of these and
 * stays a normal assumption. Anchored on forward-looking / "not yet" cues, not on
 * the mere mention of "flow" or "permission" (a built rule can mention those too).
 */
const DEFERRED_ASSUMPTION_MARKERS: readonly string[] = [
  // Chinese deferral cues.
  '待补',
  '后续', // covers 后续 / 需要后续 / 后续单独 / 后续配置
  '将在',
  '稍后',
  '暂不',
  '暂未',
  '尚未',
  '确认后一起补',
  '一起补',
  '另行', // 另行配置 / 另行补充
  '日后',
  // English deferral cues (matched lowercase).
  'not yet',
  'will be implemented',
  'will be added',
  'to be added',
  'to be implemented',
  'later',
  'deferred',
  'follow-up',
  'follow up',
  'future',
  'subsequent',
  'coming soon',
  'tbd',
];

/**
 * Splits a plan's `assumptions` into ordinary design notes vs. business rules the
 * build is explicitly deferring ("待补 / Not yet built"). Pure + side-effect-free
 * so it is unit-tested directly; the card renders the two groups distinctly so a
 * user can tell "already built" from "still to come" at a glance (improvement 2).
 *
 * Order within each group is preserved. A blank/whitespace assumption is dropped.
 */
export function classifyAssumptions(assumptions: readonly string[]): {
  designNotes: string[];
  deferred: string[];
} {
  const designNotes: string[] = [];
  const deferred: string[] = [];
  for (const raw of assumptions) {
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (!text) continue;
    const haystack = text.toLowerCase();
    if (DEFERRED_ASSUMPTION_MARKERS.some((m) => haystack.includes(m))) {
      deferred.push(text);
    } else {
      designNotes.push(text);
    }
  }
  return { designNotes, deferred };
}

function shouldRenderDetailedTool(tool: ChatbotEnhancedToolInvocation): boolean {
  const state = getToolState(tool);
  return (
    state === 'awaiting' ||
    state === 'failed' ||
    Boolean(tool.pendingActionId) ||
    Boolean(tool.draftReview?.items.length) ||
    // The pre-build "Proposed plan" card lives in the detailed tool body; route
    // a propose_blueprint result there instead of collapsing it into a chip.
    Boolean(tool.proposedPlan) ||
    Boolean(tool.proposedChanges) ||
    // ADR-0057 P4 — the "Open in Builder →" handoff lives in the detailed body.
    Boolean(tool.builderHandoff) ||
    Boolean(tool.recordHandoff) ||
    // A completed propose_blueprint that produced NO structured plan still needs
    // the detailed body — that's where the fallback "Build it" confirm gate
    // renders so the user is never left guessing the confirmation phrase.
    isUnstructuredBuildProposal(tool)
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

/**
 * The "1 object · 1 view · 1 dashboard" strip under a proposed plan / a live
 * design panel, localized (objectui#7254).
 *
 * It was assembled by string concatenation with an English `+ 's'` plural, so
 * it read as English inside an otherwise Chinese conversation AND could only
 * ever be right for the two-form languages. Each noun is a plural FAMILY (base
 * key + `_one`): i18next asks `Intl.PluralRules` for the one suffix the active
 * language needs and lands on the base key for every category a pack does not
 * enumerate, so `ru` (few/many) and `ar` (two/few/many/zero) stay in their own
 * language instead of falling through to English — the rule
 * `all-locales-key-parity.test.ts` states for plural families.
 *
 * Returned as a hook-bound formatter because both call sites live in different
 * components (the proposed-plan card body and `BlueprintProgressPanel`), and
 * two hand-rolled copies is how they drifted in the first place.
 */
function useMetadataCountBits(): (counts: {
  objects?: number;
  views?: number;
  dashboards?: number;
  seedData?: number;
}) => string[] {
  const { t } = useObjectTranslation();
  return React.useCallback(
    (counts) => {
      const bits: string[] = [];
      if (counts?.objects)
        bits.push(
          t('chatbot.plan.countObjects', {
            count: counts.objects,
            defaultValue: '{{count}} objects',
          }),
        );
      if (counts?.views)
        bits.push(
          t('chatbot.plan.countViews', { count: counts.views, defaultValue: '{{count}} views' }),
        );
      if (counts?.dashboards)
        bits.push(
          t('chatbot.plan.countDashboards', {
            count: counts.dashboards,
            defaultValue: '{{count}} dashboards',
          }),
        );
      if (counts?.seedData)
        bits.push(t('chatbot.plan.countSeedData', { defaultValue: 'sample data' }));
      return bits;
    },
    [t],
  );
}

/**
 * objectui#11658 — the extend-mode scope chip's text ("Adding to existing app:
 * APP"), shared by the proposed-plan card and `BlueprintProgressPanel`.
 *
 * The chip names the target app by its display label, resolved by the host
 * (`resolveAppLabel`), never by the machine name the plan carries — that name
 * moves to the chip's tooltip. The sentence is the locale pack's
 * `chatbot.plan.extendTarget`, so a zh user no longer reads the English literal
 * the component used to default to. A host `planExtendLabel` still wins, in the
 * `PREFIX "APP"` shape it always rendered.
 */
function useExtendChip(
  override: string | undefined,
  resolveAppLabel: ((appName: string) => string | undefined) | undefined,
): (targetApp: string) => string {
  const { t } = useObjectTranslation();
  return React.useCallback(
    (targetApp: string) => {
      const app = resolveAppLabel?.(targetApp) || targetApp;
      if (override) return `${override} "${app}"`;
      return t('chatbot.plan.extendTarget', { app, defaultValue: 'Adding to existing app: {{app}}' });
    },
    [t, override, resolveAppLabel],
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

/**
 * ADR-0038 L3 — the build-health line under a Published badge. Reads the
 * publish's `seedApplied` + runtime-probe results and answers the question
 * the badge alone can't: did the published app actually work when exercised?
 * Renders nothing without health data (older hosts return a bare boolean).
 */
function PublishHealthLine({ health }: { health: PublishHealth | undefined }) {
  if (!health) return null;
  const issues = health.issues ?? [];
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity !== 'error');
  const checked = health.checked;
  const probesRan = !!checked && checked.seeds + checked.views + checked.widgets > 0;
  const okParts: string[] = [];
  if (typeof health.seededRows === 'number' && health.seededRows > 0 && !health.seedError) {
    okParts.push(`${health.seededRows} sample row${health.seededRows === 1 ? '' : 's'} live`);
  }
  if (probesRan && errors.length === 0) {
    const planes: string[] = [];
    if (checked!.views > 0) planes.push(`${checked!.views} view${checked!.views === 1 ? '' : 's'}`);
    if (checked!.widgets > 0) planes.push(`${checked!.widgets} widget${checked!.widgets === 1 ? '' : 's'}`);
    if (checked!.seeds > 0) planes.push(`${checked!.seeds} seed${checked!.seeds === 1 ? '' : 's'}`);
    if (planes.length) okParts.push(`${planes.join(' · ')} verified`);
  }
  if (okParts.length === 0 && !health.seedError && issues.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-t bg-muted/20 px-3 py-2" data-testid="publish-health">
      {okParts.length > 0 ? (
        <div className="flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="size-3.5 shrink-0" />
          <span>{okParts.join(' · ')}</span>
        </div>
      ) : null}
      {health.seedError ? (
        <div className="flex items-start gap-1.5 text-xs text-red-600">
          <XCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{health.seedError}</span>
        </div>
      ) : null}
      {errors.map((i, idx) => (
        <div key={`e${idx}`} className="flex items-start gap-1.5 text-xs text-red-600">
          <XCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{i.message}</span>
        </div>
      ))}
      {warnings.map((i, idx) => (
        <div key={`w${idx}`} className="flex items-start gap-1.5 text-xs text-amber-600">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{i.message}</span>
        </div>
      ))}
    </div>
  );
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
      headerSlot,
      promptOverlaySlot,
      promptHeaderSlot,
      onInputChange,
      onToolApprove,
      toolApproveLabel = 'Approve',
      toolDenyLabel = 'Deny',
      toolDenyReason = 'User denied the operation',
      toolDecisions,
      onReviewDraft,
      toolReviewLabel = (n) => `Review ${n} change${n === 1 ? '' : 's'}`,
      onPublishDrafts,
      onReviewDrafts,
      onDiscardDrafts,
      onOpenBuiltApp,
      openBuiltAppLabel = 'Open app',
      onDesignBuiltApp,
      designBuiltAppLabel = 'Design in Studio',
      getArtifactAction,
      onPreviewDraftApp,
      previewDraftLabel = 'Preview',
      onPreviewDraft,
      onDraftArtifacts,
      onBuildMaterialized,
      onPlanApprovalPendingChange,
      publishDraftsLabel = 'Publish',
      publishedLabel = 'Published',
      verifiedLabel = 'Verified',
      nextStepsLabel = "What's next",
      planTitleLabel = 'Proposed plan',
      builderHandoffTitleLabel = 'Build this in the Builder',
      builderHandoffOpenLabel = 'Open in Builder →',
      recordHandoffTitleLabel = 'Open this record',
      recordHandoffOpenLabel = 'Open record →',
      builderHandoffSupersededTitle = 'A newer request is available',
      onOpenBuilder,
      onOpenRecord,
      planExtendLabel,
      resolveAppLabel,
      planQuestionsLabel = 'Confirm before building',
      planAssumptionsLabel = 'Assumptions',
      planDeferredLabel = 'Not yet built',
      planApproveHintLabel = 'Reply to approve or adjust this plan.',
      planApproveLabel = 'Build it',
      planAdjustLabel = 'Adjust',
      planBuiltLabel = 'Built',
      planBuildingLabel = 'Building…',
      planReadyLabel = 'The plan is ready. Build it now, or tell me what to adjust.',
      planApproveMessage = 'Looks good — build it as proposed.',
      planApproveDefaultsMessage = 'Build it with your best assumptions; use sensible defaults for the open questions.',
      planAnswerMessage = (question: string, option: string) => `For "${question}", go with: ${option}.`,
      changesTitleLabel = 'Confirm changes',
      changesConfirmedLabel = 'Confirmed',
      changesConfirmLabel = 'Confirm',
      changesConfirmHintLabel = 'Reply to confirm or adjust this change.',
      changesConfirmMessage = 'Confirm — apply the change you just proposed.',
      changeVerbLabels = DEFAULT_CHANGE_VERB_LABELS,
      changesApplyingLabel = 'Applying…',
      changesAppliedLabel = 'Applied',
      changesDraftedLabel = 'Saved as draft',
      changesFailedLabel = 'Not applied',
      surfaceContextLabel,
      surfaceContextTitle,
      fetchPendingDraftCount,
      autoPublishDrafts = false,
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

    // The localized "N objects · N views · N dashboards" strip, shared with
    // `BlueprintProgressPanel` so the plan card and the live design panel can
    // not word the same counts differently (objectui#7254).
    const countBitsOf = useMetadataCountBits();
    // objectui#11658 — the extend-mode scope chip, shared with
    // `BlueprintProgressPanel` so both name the target app the same way.
    const extendChip = useExtendChip(planExtendLabel, resolveAppLabel);

    // objectui#7254 — the pack lookup for every string this component owns.
    // `useSafeTranslate` is provider-safe: with no I18nProvider (tests,
    // standalone hosts) each call returns the English fallback passed beside
    // it, so nothing below can render a raw key.
    const tt = useSafeTranslate();
    // objectui#12724 — the plan card's section heads and its 等待确认 chip.
    const planAwaitingLabel = tt('chatbot.plan.awaitingConfirm', 'Awaiting confirmation');
    const planObjectsLabel = tt('chatbot.plan.objectsAndFields', 'Objects and fields');
    const planViewsLabel = tt('chatbot.plan.views', 'Views');
    // objectui#12894 — the change card's primary action when the envelope says
    // the change will be saved as a draft (`primaryAction: 'save_draft'`).
    const saveDraftLabel = tt('chatbot.changes.saveDraft', 'Save as draft');

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
        designingPlanLabel: labels?.designingPlanLabel ?? 'Designing your app…',
        // `?? DEFAULT_DESIGNING_PLAN_HINTS` (not `||`) so a caller can pass `[]`
        // to deliberately disable the rotation while keeping the lead-in label.
        designingPlanHints: labels?.designingPlanHints ?? DEFAULT_DESIGNING_PLAN_HINTS,
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

    // Draft tool calls this chat has published (auto or via the manual button),
    // so each card flips from a "Publish" button to a "Published" state instead
    // of leaving a stale, now-meaningless button. Keyed by the draft's
    // `toolCallId`, NOT its packageId: publishing a package promotes the drafts
    // PENDING AT THAT MOMENT, but a later edit into the same package is a new,
    // still-pending draft — it must NOT inherit the earlier build's "Published"
    // badge (that would falsely tell the user an unpublished change is live).
    const [publishedToolCalls, setPublishedToolCalls] = React.useState<ReadonlySet<string>>(
      () => new Set(),
    );
    // ADR-0038 L3 — per published card, what the publish actually did at
    // runtime (rows seeded, probes run, findings). Rendered under the
    // Published badge as the build-health line.
    const [publishHealthByToolCall, setPublishHealthByToolCall] = React.useState<
      ReadonlyMap<string, PublishHealth>
    >(() => new Map());

    // Live publish-state (panel-as-source-of-truth, made literal): the server's
    // CURRENT pending-draft count per package, when the host wires
    // `fetchPendingDraftCount`. The in-memory `publishedToolCalls` snapshot
    // above is an optimistic overlay for THIS session; this map is what keeps a
    // RELOADED conversation honest — published work shows "Published" (count
    // 0), and a package that gained new drafts offers Publish again, no matter
    // which session staged them.
    const [pendingByPackage, setPendingByPackage] = React.useState<
      ReadonlyMap<string, number>
    >(() => new Map());
    const pendingFetchedRef = React.useRef<Set<string>>(new Set());
    const refreshPendingCount = React.useCallback(
      async (packageId: string) => {
        if (!fetchPendingDraftCount) return;
        try {
          const count = await fetchPendingDraftCount(packageId);
          setPendingByPackage((prev) => {
            if (prev.get(packageId) === count) return prev;
            const next = new Map(prev);
            next.set(packageId, count);
            return next;
          });
        } catch {
          // Leave the package unknown — the card falls back to the
          // in-memory snapshot rather than guessing.
        }
      },
      [fetchPendingDraftCount],
    );
    // Resolve the live count as draft cards appear (incl. on mount for
    // reloaded conversations). Keyed by the card's toolCallId — a NEW build
    // into an already-seen package must refresh that package's count, or the
    // older card would keep claiming "Published" while drafts are pending.
    // Waits for the turn to finish so a mid-build fetch doesn't race the
    // still-staging drafts.
    React.useEffect(() => {
      if (!fetchPendingDraftCount || isLoading) return;
      const due = new Set<string>();
      for (const message of messages) {
        for (const tool of message.toolInvocations ?? []) {
          const pkg = tool.draftReview?.packageId;
          const key = tool.toolCallId;
          if (pkg && key && !pendingFetchedRef.current.has(key)) {
            pendingFetchedRef.current.add(key);
            due.add(pkg);
          }
        }
      }
      for (const pkg of due) void refreshPendingCount(pkg);
    }, [messages, isLoading, fetchPendingDraftCount, refreshPendingCount]);
    // Publish a package's drafts and reflect success on exactly the cards that
    // were pending for it at publish time. The host's onPublishDrafts returns
    // `false` / `{ok:false}` on failure (and surfaces its own error); any other
    // outcome (incl. void) counts as success. A structured outcome may carry
    // `health` (seedApplied + runtime probes) for the health line.
    const handlePublishDrafts = React.useCallback(
      async (packageId: string) => {
        if (!onPublishDrafts) return;
        // Snapshot the on-screen draft cards this publish will promote, BEFORE
        // awaiting — later edits into the same package won't be in this set.
        const promoted: string[] = [];
        for (const message of messages) {
          for (const tool of message.toolInvocations ?? []) {
            if (tool.draftReview?.packageId === packageId && tool.toolCallId) {
              promoted.push(tool.toolCallId);
            }
          }
        }
        const res = await onPublishDrafts(packageId);
        const outcome: PublishOutcome | undefined =
          res && typeof res === 'object' ? (res as PublishOutcome) : undefined;
        const ok = outcome ? outcome.ok !== false : res !== false;
        if (ok && promoted.length > 0) {
          setPublishedToolCalls((prev) => {
            const next = new Set(prev);
            for (const id of promoted) next.add(id);
            return next;
          });
          const health = outcome?.health;
          if (health) {
            setPublishHealthByToolCall((prev) => {
              const next = new Map(prev);
              for (const id of promoted) next.set(id, health);
              return next;
            });
          }
        }
        // Re-read the server's pending count so every card bound to this
        // package reflects the post-publish truth (0 on success; unchanged
        // on failure — the button stays).
        void refreshPendingCount(packageId);
      },
      [onPublishDrafts, messages, refreshPendingCount],
    );

    // objectui#12894 — 撤销 on the applied card of a change saved as a draft
    // (cloud#2924). The door the host wires (`discard-drafts`) discards EVERY
    // pending draft of the package, so the card asks before it runs whenever it
    // cannot show that only this change is pending. Per card, keyed by the
    // proposal's toolCallId; UI-owned like `confirmPendingIds`.
    const [discardByToolCall, setDiscardByToolCall] = React.useState<
      ReadonlyMap<string, DraftDiscardState>
    >(() => new Map());
    const setDiscardState = React.useCallback(
      (toolCallId: string, state: DraftDiscardState | undefined) => {
        setDiscardByToolCall((prev) => {
          const next = new Map(prev);
          if (state) next.set(toolCallId, state);
          else next.delete(toolCallId);
          return next;
        });
      },
      [],
    );
    const runDiscardDrafts = React.useCallback(
      async (toolCallId: string, packageId: string) => {
        if (!onDiscardDrafts) return;
        setDiscardState(toolCallId, { phase: 'running' });
        try {
          const res = await onDiscardDrafts(packageId);
          const outcome = res && typeof res === 'object' ? res : undefined;
          const ok = outcome ? outcome.ok !== false : res !== false;
          setDiscardState(
            toolCallId,
            ok ? { phase: 'done' } : { phase: 'failed', ...(outcome?.error ? { error: outcome.error } : {}) },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
          setDiscardState(toolCallId, { phase: 'failed', ...(message ? { error: message } : {}) });
        }
        // Every card bound to this package reads the post-discard count.
        void refreshPendingCount(packageId);
      },
      [onDiscardDrafts, setDiscardState, refreshPendingCount],
    );
    // The click on 撤销: run at once only when the drafts pending are this
    // change's alone. The snapshot is `draftState` (read when the change
    // landed); the host's live count, when it gives one, wins over it — a
    // later change in the same conversation stages more drafts into the same
    // package, and the snapshot on this older card cannot know that.
    const requestDiscardDrafts = React.useCallback(
      async (
        toolCallId: string,
        packageId: string,
        draftState: ReplayOutcome['draftState'],
      ) => {
        if (!onDiscardDrafts) return;
        let others = draftState?.others;
        let total = draftState?.pending;
        if (fetchPendingDraftCount) {
          setDiscardState(toolCallId, { phase: 'running' });
          try {
            const live = await fetchPendingDraftCount(packageId);
            if (typeof live === 'number' && Number.isInteger(live) && live >= 0) {
              total = live;
              others = draftState ? Math.max(0, live - (draftState.pending - draftState.others)) : undefined;
            }
          } catch {
            // Unreadable: the snapshot stands.
          }
        }
        if (others === 0) {
          await runDiscardDrafts(toolCallId, packageId);
          return;
        }
        setDiscardState(toolCallId, {
          phase: 'confirm',
          ...(others !== undefined ? { others } : {}),
          ...(total !== undefined ? { total } : {}),
        });
      },
      [onDiscardDrafts, fetchPendingDraftCount, runDiscardDrafts, setDiscardState],
    );

    // Auto-publish "magic moment": when the environment enables autoPublishDrafts
    // and a WHOLE-APP build finishes (the backend marks it `autoPublishable`),
    // fire the same publish-drafts call the manual button uses — objects go live
    // and seed data loads, so the user lands on a populated, running app instead
    // of hunting for Publish. Incremental edits are NOT auto-published: they omit
    // `autoPublishable` and stay drafts for explicit review (a destructive edit
    // must never go live silently). Drafts already on screen when the chat mounts
    // are seeded as "seen" so reopening a conversation never republishes prior
    // work; only NEW builds fire, each at most once, after streaming completes.
    //
    // Dedup is keyed by the draft tool's `toolCallId`, NOT its packageId: every
    // build is a distinct tool call and several can target the SAME workspace
    // package in one session. Keying by packageId would publish it only once and
    // silently leave later builds staged. Keyed by toolCallId, each new build
    // publishes its package once (publish-drafts only promotes rows still
    // pending, so re-publishing a package is safe).
    const autoPublishedRef = React.useRef<Set<string>>(new Set());
    const autoPublishSeededRef = React.useRef(false);
    React.useEffect(() => {
      const builds: Array<{ key: string; packageId: string }> = [];
      for (const message of messages) {
        for (const tool of message.toolInvocations ?? []) {
          const dr = tool.draftReview;
          if (dr?.autoPublishable && dr.packageId && tool.toolCallId && dr.items.length > 0) {
            builds.push({ key: tool.toolCallId, packageId: dr.packageId });
          }
        }
      }
      if (!autoPublishSeededRef.current) {
        autoPublishSeededRef.current = true;
        for (const b of builds) autoPublishedRef.current.add(b.key);
        return;
      }
      // Wait for the turn to finish so we publish the complete build once.
      if (!autoPublishDrafts || !onPublishDrafts || isLoading) return;
      const fresh = builds.filter((b) => !autoPublishedRef.current.has(b.key));
      if (fresh.length === 0) return;
      for (const b of fresh) autoPublishedRef.current.add(b.key);
      // One publish per distinct package, even if a turn made several build calls.
      for (const pkg of [...new Set(fresh.map((b) => b.packageId))]) void handlePublishDrafts(pkg);
    }, [messages, isLoading, autoPublishDrafts, onPublishDrafts, handlePublishDrafts]);

    // ADR-0037 Live Canvas: surface every AI-authored draft artifact to the
    // host as it lands — both the streaming build tree's items and drafted
    // envelopes. Deduped cumulatively; the callback fires only when the set
    // actually grows, so hosts can refresh a preview pane without storms.
    const draftArtifactKeysRef = React.useRef<Set<string>>(new Set());
    React.useEffect(() => {
      if (!onDraftArtifacts) return;
      const artifacts = new Map<string, { type: string; name: string }>();
      // The preview pane routes on the app's PACKAGE id (ADR-0048), not its
      // name — take it from the draft set that includes the app.
      let appSegment: string | undefined;
      for (const message of messages) {
        for (const item of message.buildProgress?.items ?? []) {
          if (item?.type && item?.name) artifacts.set(`${item.type}:${item.name}`, item);
        }
        for (const tool of message.toolInvocations ?? []) {
          const dr = tool.draftReview;
          for (const item of dr?.items ?? []) {
            if (item?.type && item?.name) artifacts.set(`${item.type}:${item.name}`, item);
          }
          if (dr?.packageId && dr.items?.some((i) => i.type === 'app')) appSegment = dr.packageId;
        }
      }
      const seen = draftArtifactKeysRef.current;
      let grew = false;
      for (const key of artifacts.keys()) {
        if (!seen.has(key)) {
          seen.add(key);
          grew = true;
        }
      }
      if (grew) onDraftArtifacts([...artifacts.values()], appSegment);
    }, [messages, onDraftArtifacts]);

    // ADR-0045: announce materialized builds (real app live, unlisted) so the
    // host flips its canvas from the draft overlay to the real app URL. Once
    // per build (keyed by toolCallId), including on conversation reload —
    // a reopened materialized build should still preview the real app.
    const materializedKeysRef = React.useRef<Set<string>>(new Set());
    React.useEffect(() => {
      if (!onBuildMaterialized) return;
      for (const message of messages) {
        for (const tool of message.toolInvocations ?? []) {
          const dr = tool.draftReview;
          if (!dr?.materialized || !tool.toolCallId) continue;
          const app = dr.items.find((i) => i.type === 'app');
          if (!app || materializedKeysRef.current.has(tool.toolCallId)) continue;
          materializedKeysRef.current.add(tool.toolCallId);
          onBuildMaterialized(app.name);
        }
      }
    }, [messages, onBuildMaterialized]);

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

    const handleSubmit = React.useCallback(
      (payload: PromptInputMessage) => {
        const hasText = Boolean(payload.text?.trim());
        const files = payload.files
          ?.map((f) => (f as unknown as { file?: File }).file)
          .filter(Boolean) as File[] | undefined;
        const hasFiles = Boolean(files && files.length > 0);
        if (!(hasText || hasFiles)) return;
        const text = payload.text?.trim() ?? '';
        // Remember the text so a rejected send can restore it (the composer's
        // own form.reset clears the box optimistically). A fresh attempt also
        // clears any prior send-failure restore guard.
        lastSubmittedRef.current = text;
        restoredErrorRef.current = null;
        // A newer send supersedes any pending approve as "the last send" — an
        // unsent failure of THIS message must not roll back a plan card whose
        // approval already reached the server (#2627).
        lastApprovedPlanIdRef.current = null;
        onSendMessage?.(text, files);
        followThreadToBottom();
      },
      [onSendMessage, followThreadToBottom]
    );

    const handleSuggestionClick = React.useCallback(
      (text: string) => {
        lastApprovedPlanIdRef.current = null;
        // Not typed by the user — nothing to restore if this send is rejected
        // (see the send-failure effect below).
        lastSubmittedRef.current = '';
        onSendMessage?.(text);
        followThreadToBottom();
      },
      [onSendMessage, followThreadToBottom]
    );

    // The "Proposed plan" card's one-click confirm gate. Approving sends a plain
    // chat message — the same channel the user would type into — so the agent
    // proceeds to apply_blueprint. When the plan still carries open questions,
    // approval explicitly authorizes sensible defaults so a click never silently
    // drops them.
    const promptInputWrapRef = React.useRef<HTMLDivElement>(null);
    // Optimistic per-card feedback (#2627): the approval's visible effect (a
    // new user bubble + a streaming turn) lands at the BOTTOM of the thread —
    // outside the viewport when the plan card is scrolled into view — so the
    // card itself looked untouched for the ~10s until apply_blueprint started
    // and users clicked again. Flip the clicked card to a "Building…" badge
    // immediately; the durable Built state still derives from the message
    // stream (builtPlanIds). A send that never left the client (rate limit /
    // offline) rolls the flip back so the buttons return.
    const [approvedPlanIds, setApprovedPlanIds] = React.useState<ReadonlySet<string>>(
      () => new Set<string>(),
    );
    const lastApprovedPlanIdRef = React.useRef<string | null>(null);
    const handlePlanApprove = React.useCallback(
      (hasOpenQuestions: boolean, toolCallId?: string) => {
        // Canned approval text, not the user's typing — see `handleSubmit`.
        lastSubmittedRef.current = '';
        if (toolCallId) {
          lastApprovedPlanIdRef.current = toolCallId;
          setApprovedPlanIds((prev) => {
            const next = new Set(prev);
            next.add(toolCallId);
            return next;
          });
        }
        onSendMessage?.(hasOpenQuestions ? planApproveDefaultsMessage : planApproveMessage);
        followThreadToBottom();
      },
      [onSendMessage, planApproveMessage, planApproveDefaultsMessage, followThreadToBottom]
    );
    // objectui#5695 — same optimistic pattern for the 确认修改 card: flip it to
    // an "Applying…" badge the moment the approval is sent (double-click guard +
    // immediate feedback); the durable terminal state derives from the replay
    // envelope in the message stream (replayOutcomeByProposalId). A send that
    // never left the client rolls the flip back so the buttons return.
    const [confirmPendingIds, setConfirmPendingIds] = React.useState<ReadonlySet<string>>(
      () => new Set<string>(),
    );
    const lastConfirmedChangeIdRef = React.useRef<string | null>(null);
    // objectui#7253 — cards whose confirm was refused by the AI quota guardrail
    // (429), keyed to the refusal that blocked them. UI-owned and terminal for
    // this mount: the refusal never reached the server, so no message-stream
    // envelope will ever speak for it, and the paywall does not lift on a retry.
    // The error is KEPT (not just a flag) so the card's next step still reads
    // correctly after `error` clears — the user typing again must not silently
    // strip the reason off a card that is still blocked.
    const [quotaBlockedChanges, setQuotaBlockedChanges] = React.useState<
      ReadonlyMap<string, unknown>
    >(() => new Map<string, unknown>());
    const handleChangesConfirm = React.useCallback(
      (toolCallId?: string) => {
        // Canned confirmation text, not the user's typing — see `handleSubmit`.
        lastSubmittedRef.current = '';
        if (toolCallId) {
          lastConfirmedChangeIdRef.current = toolCallId;
          setConfirmPendingIds((prev) => {
            const next = new Set(prev);
            next.add(toolCallId);
            return next;
          });
        }
        onSendMessage?.(changesConfirmMessage);
        followThreadToBottom();
      },
      [onSendMessage, changesConfirmMessage, followThreadToBottom],
    );

    // "Adjust" doesn't send anything — it just drops the cursor into the input so
    // the user can describe the change in their own words.
    const handlePlanAdjust = React.useCallback(() => {
      const textarea = promptInputWrapRef.current?.querySelector('textarea');
      if (textarea) {
        textarea.focus();
        textarea.scrollIntoView({ block: 'nearest' });
      }
    }, []);

    // Restore the composer text when a send was REJECTED before reaching the
    // model (rate-limit / network — `notSent`). The composer's own form.reset
    // clears the box optimistically and the optimistic user bubble was rolled
    // back (useObjectChat), so without this the typed message would just vanish.
    // Runs once per failure and never clobbers text the user has since typed.
    React.useEffect(() => {
      if (!error || !isUnsentSendError(error)) return;
      if (restoredErrorRef.current === error) return;
      restoredErrorRef.current = error;
      // The approval message never left the client — roll the optimistic
      // "Building…" badge back so the Build-it button returns (#2627).
      if (lastApprovedPlanIdRef.current) {
        const failedId = lastApprovedPlanIdRef.current;
        lastApprovedPlanIdRef.current = null;
        setApprovedPlanIds((prev) => {
          if (!prev.has(failedId)) return prev;
          const next = new Set(prev);
          next.delete(failedId);
          return next;
        });
      }
      // Same rollback for an unsent 确认修改 approval (objectui#5695) — with one
      // split (objectui#7253): a QUOTA refusal is not a retry, so the card must
      // not quietly re-offer the buttons that just failed. Returning them is
      // right for a transient failure (rate limit, offline) and a dead end for a
      // paywall — the user clicks Confirm again and hits the same 429, with the
      // card still reading "awaiting approval". A quota refusal parks the card
      // in an explicit blocked state carrying the next step instead.
      if (lastConfirmedChangeIdRef.current) {
        const failedId = lastConfirmedChangeIdRef.current;
        lastConfirmedChangeIdRef.current = null;
        setConfirmPendingIds((prev) => {
          if (!prev.has(failedId)) return prev;
          const next = new Set(prev);
          next.delete(failedId);
          return next;
        });
        if (parseAiQuotaError(error)) {
          setQuotaBlockedChanges((prev) => {
            if (prev.has(failedId)) return prev;
            const next = new Map(prev);
            next.set(failedId, error);
            return next;
          });
        }
      }
      // Only text the user TYPED here is restorable. `lastSubmittedRef` is
      // written by `handleSubmit` alone and cleared by every card-driven send,
      // because those send a canned message the user never typed — leaving the
      // ref stale refilled the composer with the user's PREVIOUS prompt, a
      // message that had already been delivered and answered, reading as
      // "resend this" (objectui#7253).
      const text = lastSubmittedRef.current;
      if (!text) return;
      const textarea = promptInputWrapRef.current?.querySelector('textarea');
      if (textarea && textarea.value.trim() === '') {
        textarea.value = text;
        // Nudge the auto-grow sizing + any onInputChange listener.
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
      }
    }, [error]);

    const handleCopy = React.useCallback((message: ChatbotEnhancedMessage) => {
      void navigator.clipboard?.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((prev) => (prev === message.id ? null : prev)), 1500);
    }, []);

    // issue #432: a "Proposed plan" card whose build has already run must not
    // keep offering an active "Build it" — clicking it re-sent the approval and
    // re-triggered the entire build. A plan is "built" once an `apply_blueprint`
    // tool invocation appears AFTER it in the conversation. Keyed on `toolName`
    // (not the rich `draftReview`, which a reloaded conversation strips), so the
    // done-state survives a refresh. Positional so a later, not-yet-built plan
    // (e.g. after "make it simpler") keeps its live button.
    //
    // objectui#8343 — the name alone is NOT enough. When the user didn't say the
    // magic "直接搭建", `apply_blueprint` hits its own confirm gate and returns
    // `{status:'awaiting_confirmation'}`: it built nothing and is itself waiting
    // for the user. Counting that as a build collapsed the plan card to the inert
    // 已搭建 badge and took its "Build it" button with it, while the
    // apply_blueprint card has no button of its own — the turn was left with
    // nothing to click and the only way out was guessing "确认" into the composer.
    // So a build only counts when the invocation is not a confirm-gate preview,
    // the same fact `getToolState` already reads to say "Awaiting Approval".
    const builtPlanIds = React.useMemo(() => {
      const ids = new Set<string>();
      const plans: Array<{ id: string; order: number }> = [];
      let lastBuildOrder = -1;
      let order = 0;
      for (const message of messages) {
        for (const tool of message.toolInvocations ?? []) {
          // Both the structured plan card AND the fallback confirm card (an
          // unstructured propose_blueprint) own a "Build it" button, so both must
          // collapse to the inert "Built" badge once their build has run.
          if ((tool.proposedPlan || isUnstructuredBuildProposal(tool)) && tool.toolCallId) {
            plans.push({ id: tool.toolCallId, order });
          }
          // A still-running apply (no result yet) DOES count: the build is in
          // flight, and a second "Build it" would re-trigger it (#432).
          if (tool.toolName === 'apply_blueprint' && !isProposalResult(tool.result)) {
            lastBuildOrder = order;
          }
          order += 1;
        }
      }
      for (const p of plans) if (p.order < lastBuildOrder) ids.add(p.id);
      return ids;
    }, [messages]);

    // #2458 UX#5 — only the LATEST "Open in Builder →" handoff card stays
    // actionable; older cards carry a now-stale prompt and go inert, so a thread
    // that accumulated several can't re-fire an outdated request. Derived from
    // message order (not click state), so it survives the navigation the button
    // triggers and the pane remount that follows.
    const latestHandoffToolCallId = React.useMemo(() => {
      let latest: string | undefined;
      for (const message of messages) {
        for (const tool of message.toolInvocations ?? []) {
          if (tool.builderHandoff && tool.toolCallId) latest = tool.toolCallId;
        }
      }
      return latest;
    }, [messages]);

    // A granular 确认修改 card collapses to a static 已确认 badge once the change
    // has been applied — i.e. a LATER invocation of the SAME tool committed (no
    // longer a changes_proposed preview). Positional + per-tool so an earlier
    // confirmed change doesn't silence a later still-pending one.
    //
    // objectui#8343 — "no longer a preview" was inferred from the ABSENCE of the
    // rich `proposedChanges` card, which is a stricter thing: that detector also
    // needs ≥1 parseable change row. So a later same-tool call that WAS a preview
    // but produced no card (an empty `changes:[]`, an `awaiting_confirmation`)
    // silently counted as the commit and settled the pending card — the same
    // defect `builtPlanIds` had above. Read the preview fact directly instead.
    const confirmedChangeIds = React.useMemo(() => {
      const ids = new Set<string>();
      const proposals: Array<{ id: string; toolName: string; order: number }> = [];
      const lastCommitByTool = new Map<string, number>();
      let order = 0;
      for (const message of messages) {
        for (const tool of message.toolInvocations ?? []) {
          if (tool.proposedChanges && tool.toolCallId) {
            proposals.push({ id: tool.toolCallId, toolName: tool.toolName ?? '', order });
          } else if (tool.toolName && !isProposalResult(tool.result)) {
            lastCommitByTool.set(tool.toolName, order);
          }
          order += 1;
        }
      }
      for (const p of proposals) {
        const commit = lastCommitByTool.get(p.toolName);
        if (commit !== undefined && commit > p.order) ids.add(p.id);
      }
      return ids;
    }, [messages]);

    // objectui#5695 — correlate each confirm-replay result back to the 确认修改
    // card it replays, so the card carries a UI-owned terminal state (已生效 /
    // 已暂存为草稿 / 未生效) instead of going dark after the click. A replay
    // re-dispatches the SAME tool, so the match is "latest earlier proposal of
    // the same tool" — the same positional+per-tool convention as
    // `confirmedChangeIds` above. A replay invocation still awaiting its result
    // marks the card 'applying'; later replays of the same card overwrite
    // earlier ones (an adjusted-and-reconfirmed change reports its LAST run).
    //
    // Self-repair supersede (measured live 2026-08-24): a replay whose DISPATCH
    // errored (`dispatchError`) may be followed, in the same turn, by the model
    // landing the change through different tool calls. Any LATER non-replay
    // invocation whose result parses as an authoring verdict overrides the
    // provisional failure — the card must never say 未生效 over a change that
    // actually landed (that would be the original bug, mirrored).
    const replayOutcomeByProposalId = React.useMemo(() => {
      const byId = new Map<
        string,
        NonNullable<ChatbotEnhancedToolInvocation['replayOutcome']> | { kind: 'applying' }
      >();
      const dispatchErrorTargets = new Map<string, number>(); // proposalId → replay order
      const proposals: Array<{ id: string; toolName: string; order: number }> = [];
      let order = 0;
      for (const message of messages) {
        for (const tool of message.toolInvocations ?? []) {
          if (tool.proposedChanges && tool.toolCallId) {
            proposals.push({ id: tool.toolCallId, toolName: tool.toolName ?? '', order });
            dispatchErrorTargets.delete(tool.toolCallId);
          } else if (tool.toolCallId?.startsWith('replay_')) {
            let target: { id: string } | undefined;
            for (const p of proposals) {
              if (p.order < order && p.toolName === (tool.toolName ?? '')) target = p;
            }
            if (target) {
              if (tool.replayOutcome) {
                byId.set(target.id, tool.replayOutcome);
                if (tool.replayOutcome.dispatchError) dispatchErrorTargets.set(target.id, order);
                else dispatchErrorTargets.delete(target.id);
              } else if (tool.result === undefined && !tool.errorText) {
                byId.set(target.id, { kind: 'applying' });
              }
            }
          } else if (tool.result !== undefined && dispatchErrorTargets.size > 0) {
            const verdict = detectAuthoringVerdict(tool.result);
            if (verdict) {
              for (const [pid, replayOrder] of dispatchErrorTargets) {
                if (order > replayOrder) byId.set(pid, verdict);
              }
            }
          }
          order += 1;
        }
      }
      return byId;
    }, [messages]);

    // objectui#10925 — the proposed-plan card's actions (Build it, Adjust and
    // the one-click answer chips) wait until no turn is in flight. The card
    // renders as soon as `propose_blueprint` returns, but the proposing turn
    // keeps streaming after that (a `todo_write`, the closing prose), and the
    // server stores each of those steps as it goes. A Build it clicked in that
    // window sent the next turn while the previous one was still being stored,
    // and the stored history interleaved the two turns.
    //
    // The signal is `isLoading`, the same one that turns the composer's send
    // into a stop button. It falls only once the response stream has been
    // read to its end. The cloud agent loop (`streamChatWithTools`) stores the
    // turn's final reply before it writes `finish`; that is the server's
    // ordering, read once for this card, and nothing in this repo re-checks
    // it. A message's own `streaming` flag is derived from `isLoading`
    // (`uiMessagesToChatMessages` sets it on the trailing assistant message
    // only), so it would miss two windows that overlap turns the same way:
    // the `submitted` phase before the first chunk, and a newer turn
    // streaming below an older plan card.
    const planActionsLocked = isLoading;

    // objectui#11666 — is this thread's newest proposed plan still waiting for
    // the user? Read off the SAME producer the plan card's header and body read
    // (`resolveProposalCardState`, objectui#7254), so the host's mirror can
    // never disagree with the card: `pending` is exactly the state that renders
    // "Build it". The newest plan card is the one awaiting — an older card a
    // newer proposal followed is superseded by it. Computed on every render
    // rather than memoised: it is one pass over the tool calls, and its inputs
    // are memo results whose identity this must not key on (Commandment #10).
    let newestPlanId: string | undefined;
    for (const message of messages) {
      for (const tool of message.toolInvocations ?? []) {
        if ((tool.proposedPlan || isUnstructuredBuildProposal(tool)) && tool.toolCallId) {
          newestPlanId = tool.toolCallId;
        }
      }
    }
    const planApprovalPending =
      newestPlanId !== undefined &&
      resolveProposalCardState({
        replayOutcome: replayOutcomeByProposalId.get(newestPlanId),
        built: builtPlanIds.has(newestPlanId),
        confirmed: confirmedChangeIds.has(newestPlanId),
        approved: approvedPlanIds.has(newestPlanId),
      }) === 'pending';
    // The host's callback is read through a ref so the effect keys on the
    // boolean alone — a host that passes a fresh function each render must not
    // re-announce an unchanged reading.
    const onPlanApprovalPendingChangeRef = React.useRef(onPlanApprovalPendingChange);
    React.useEffect(() => {
      onPlanApprovalPendingChangeRef.current = onPlanApprovalPendingChange;
    }, [onPlanApprovalPendingChange]);
    React.useEffect(() => {
      onPlanApprovalPendingChangeRef.current?.(planApprovalPending);
    }, [planApprovalPending]);

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
      // A drafting tool (create_object / apply_blueprint) is NOT a reason to dump
      // JSON: the human summary + the Publish/Review affordance below already tell
      // a Build-with-AI user what happened, so on the consumer surface (`summary`)
      // the whole-app blueprint JSON and "status: drafted" envelopes stay hidden.
      const showPayload =
        processVisibility === 'debug' ||
        isAwaitingApproval;
      // Lifecycle truth for this card's draft package, in precedence order:
      // the server's live pending-draft count (host wired
      // `fetchPendingDraftCount`), else this session's in-memory publish
      // history. The live count is what keeps reloaded conversations and
      // cross-session edits honest.
      const draftPackageId = tool.draftReview?.packageId;
      const livePendingCount = draftPackageId !== undefined
        ? pendingByPackage.get(draftPackageId)
        : undefined;
      const draftIsPublished = livePendingCount !== undefined
        ? livePendingCount === 0
        : publishedToolCalls.has(tool.toolCallId);
      // A tool with no output yet is RUNNING — show a live elapsed timer next to
      // its title so a long blueprint/build call has a visible countdown, not a
      // static "Running" (issue #432).
      const isRunning = state === 'input-streaming' || state === 'input-available';
      // #772 — the HEADER badge state. A tool that RETURNED a confirm-before-
      // change PREVIEW (changes_proposed / blueprint_proposed) reads as
      // "Awaiting Approval", not "Completed": nothing was applied, it's waiting
      // for the user. Only the header badge is remapped — the local `state`
      // (which gates payload display / HITL) is untouched.
      //
      // objectui#7254 — "waiting for the user" is only true until the user acts.
      // The header used to stop reading here, so a card whose BODY had already
      // collapsed to 已搭建 / 已生效 / 未生效 kept saying "Awaiting Approval".
      // `resolveProposalCardState` is now the one producer both sides read.
      const proposalCardState = resolveProposalCardState({
        replayOutcome: replayOutcomeByProposalId.get(tool.toolCallId),
        built: builtPlanIds.has(tool.toolCallId),
        confirmed: confirmedChangeIds.has(tool.toolCallId),
        approved: approvedPlanIds.has(tool.toolCallId),
      });
      const headerState =
        state === 'output-available' && isProposalResult(tool.result)
          ? PROPOSAL_HEADER_STATE[proposalCardState]
          : state;
      const titleNode = (
        <span className="inline-flex min-w-0 items-center gap-2">
          <span>{friendlyTitle || tool.toolName}</span>
          {showRawName ? (
            <code className="rounded bg-muted px-1 py-px text-[10px] font-mono text-muted-foreground">
              {tool.toolName}
            </code>
          ) : null}
          {isRunning ? (
            // The plan-design step gets the friendly rotating-hint indicator
            // (long atomic call, no stream); every other running tool keeps the
            // compact timer. Mirrors the summary-strip treatment.
            isBuildProposalTool(tool) ? (
              <BuildProposalProgressHint
                label={L.designingPlanLabel}
                hints={L.designingPlanHints}
                offlineLabel={L.connectionOfflineLabel}
              />
            ) : (
              <ToolRunningTimer offlineLabel={L.connectionOfflineLabel} />
            )
          ) : null}
        </span>
      );

      return (
        <Tool
          key={tool.toolCallId}
          defaultOpen={
            state === 'output-error' ||
            state === 'approval-requested' ||
            Boolean(tool.draftReview && tool.draftReview.items.length > 0) ||
            Boolean(tool.proposedPlan) ||
            Boolean(tool.proposedChanges) ||
            // ADR-0057 P4 — open so the "Open in Builder →" action is visible.
            Boolean(tool.builderHandoff) ||
            Boolean(tool.recordHandoff) ||
            // Fallback confirm gate (unstructured proposal) must open so its
            // "Build it" button is visible without an extra click.
            isUnstructuredBuildProposal(tool)
          }
        >
          <ToolHeader
            type={partType}
            state={headerState}
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
            {decision ? (
              <div
                className={
                  'flex items-center gap-2 p-3 border-t text-xs ' +
                  (decision.state === 'error'
                    ? 'bg-destructive/10 text-destructive'
                    : decision.state === 'success'
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : 'bg-muted/30 text-muted-foreground')
                }
              >
                <span aria-hidden="true">
                  {decision.state === 'pending'
                    ? '...'
                    : decision.state === 'success'
                      ? 'OK'
                      : 'X'}
                </span>
                <span>
                  {decision.message ??
                    (decision.state === 'pending'
                      ? 'Submitting decision...'
                      : decision.state === 'success'
                        ? 'Action approved and executed.'
                        : 'Decision failed.')}
                </span>
              </div>
            ) : null}
            {isAwaitingApproval ? (
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
            {tool.draftReview &&
            tool.draftReview.items.length > 0 &&
            (onReviewDraft ||
              ((onPublishDrafts || onPreviewDraft) && tool.draftReview.packageId)) ? (
              <>
                {/* flex-wrap so the action buttons drop to a new line on a
                    narrow (mobile) row instead of forcing horizontal scroll. */}
                <div className="flex flex-wrap items-center gap-2 p-3 border-t bg-muted/30">
                  {onPublishDrafts && tool.draftReview.packageId ? (
                    draftIsPublished ? (
                      // Published (auto or manual): a stable status badge, not a
                      // stale button. Keeps the card honest about lifecycle state.
                      <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="size-3.5" />
                        {publishedLabel}
                        {tool.draftReview.failedCount
                          ? ` · ${tool.draftReview.failedCount} need${tool.draftReview.failedCount === 1 ? 's' : ''} attention`
                          : ''}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handlePublishDrafts(tool.draftReview!.packageId!)}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        data-testid="draft-publish"
                      >
                        <Rocket className="size-3.5" />
                        {publishDraftsLabel}
                        {typeof livePendingCount === 'number' && livePendingCount > 0
                          ? ` (${livePendingCount})`
                          : ''}
                      </button>
                    )
                  ) : null}
                  {onReviewDraft ? (
                    <button
                      type="button"
                      onClick={() => onReviewDraft(tool.draftReview!.items)}
                      className={
                        onPublishDrafts && tool.draftReview.packageId
                          ? 'inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted'
                          : 'inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90'
                      }
                    >
                      <GitCompareArrows className="size-3.5" />
                      {toolReviewLabel(tool.draftReview.items.length)}
                    </button>
                  ) : null}
                  {/* ADR-0037: drafted-app preview — see it as-if-published
                      without publishing. A draft set that includes an app
                      previews the app (the canvas previews whole apps).
                      objectui#12968 (objectstack#24324 ruling A): any other
                      draft previews too, through `onPreviewDraft`, which
                      opens the affected surface; it needs the package id,
                      the app's route segment. Hidden once the package has
                      no pending drafts (live count when available, else this
                      session's history). */}
                  {!draftIsPublished
                    ? (() => {
                        const review = tool.draftReview!;
                        const preview = draftPreviewAction(review.items, review.packageId, review.materialized === true, {
                          onPreviewDraftApp,
                          onPreviewDraft,
                        });
                        return preview ? (
                          <button
                            type="button"
                            onClick={preview.run}
                            className="inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted"
                            data-testid={preview.app ? 'draft-preview-app' : 'draft-preview'}
                          >
                            <Eye className="size-3.5" />
                            {previewDraftLabel}
                          </button>
                        ) : null;
                      })()
                    : null}
                  {/* ADR-0038 L1 chip: the graph-lint verdict, so the user sees
                      WHY a build did or didn't auto-publish without reading
                      tool JSON. Green = referentially clean; amber = blocking
                      issues, the build stays draft until the agent repairs. */}
                  {tool.draftReview.verification ? (
                    tool.draftReview.verification.errors > 0 ? (
                      <span
                        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 text-xs font-medium text-amber-700"
                        data-testid="draft-verification-chip"
                      >
                        <TriangleAlert className="size-3.5" />
                        {`${tool.draftReview.verification.errors} issue${tool.draftReview.verification.errors === 1 ? '' : 's'}`}
                      </span>
                    ) : (
                      <span
                        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-medium text-emerald-700"
                        data-testid="draft-verification-chip"
                      >
                        <ShieldCheck className="size-3.5" />
                        {verifiedLabel}
                      </span>
                    )
                  ) : null}
                  {tool.draftReview.summary ? (
                    // min-w-0 + flex-1 so this nowrap summary TRUNCATES within the
                    // row instead of expanding it past the viewport on mobile
                    // (#2493 — a flex child needs min-w-0 for `truncate` to bite).
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {tool.draftReview.summary}
                    </span>
                  ) : null}
                </div>
                {/* ADR-0038 L1 — the findings behind the issues chip, so the
                    user sees WHAT is broken (and the fix hint) instead of a
                    bare "N issues" count with no way to learn more. Mirrors the
                    L3 health line below. */}
                {tool.draftReview.issues && tool.draftReview.issues.length > 0 ? (
                  <div
                    className="flex flex-col gap-1 border-t bg-muted/20 px-3 py-2"
                    data-testid="draft-issues"
                  >
                    {tool.draftReview.issues
                      .filter((i) => i.severity === 'error')
                      .map((iss, idx) => (
                        <div
                          key={`e${idx}`}
                          className="flex items-start gap-1.5 text-xs text-red-600"
                        >
                          <XCircle className="mt-0.5 size-3.5 shrink-0" />
                          <span>{iss.fix ? `${iss.message} — ${iss.fix}` : iss.message}</span>
                        </div>
                      ))}
                    {tool.draftReview.issues
                      .filter((i) => i.severity !== 'error')
                      .map((iss, idx) => (
                        <div
                          key={`w${idx}`}
                          className="flex items-start gap-1.5 text-xs text-amber-600"
                        >
                          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                          <span>{iss.message}</span>
                        </div>
                      ))}
                  </div>
                ) : null}
                {/* ADR-0038 L3 — build-health line: what the publish actually
                    did at runtime. Renders only when the host supplied health
                    data; "Published" alone never implies "verified". */}
                {publishedToolCalls.has(tool.toolCallId) ? (
                  <PublishHealthLine health={publishHealthByToolCall.get(tool.toolCallId)} />
                ) : null}
                {/* Post-build getting-started checklist — concrete next actions
                    (make the data yours, refine, automate, publish) so a finished
                    build isn't a dead end. Backend supplies these as
                    `nextSteps` on the apply_blueprint result; lifecycle-neutral. */}
                {/* objectui#12724 — a whole-app build says its next steps on
                    the finished build card instead (「接下来可以说」), so
                    only an incremental edit keeps the list here. */}
                {tool.draftReview.nextSteps &&
                tool.draftReview.nextSteps.length > 0 &&
                !buildProgressFromDraftReview(tool.draftReview) ? (
                  <div
                    className="flex flex-col gap-1 border-t bg-muted/20 px-3 py-2"
                    data-testid="draft-next-steps"
                  >
                    <span className="text-xs font-medium text-foreground/80">{nextStepsLabel}</span>
                    {tool.draftReview.nextSteps.map((step, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-1.5 text-xs text-muted-foreground"
                      >
                        <span className="mt-px shrink-0 text-foreground/40">→</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
            {/* Pre-build "Proposed plan" card — propose_blueprint returns a plan
                (objects, assumptions, structure-deciding questions) before
                anything is staged. Surfacing it as a reviewable card (not a bare
                "Completed" step) gives the user the Airtable-style confirm gate:
                see what will be built, then approve or adjust. Nothing is live
                yet. */}
            {/* ADR-0057 P4 — the `ask` agent declined an authoring request and
                called `suggest_builder`. Render an explicit "Open in Builder →"
                that hands the request to the build surface seeded with the
                prompt (ADR-0063 decline-and-redirect — never a silent re-route). */}
            {tool.builderHandoff ? (
              <div
                className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2.5"
                data-testid="builder-handoff"
              >
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
                  <Sparkles className="size-3.5" />
                  {builderHandoffTitleLabel}
                </span>
                <p className="text-xs text-muted-foreground">{tool.builderHandoff.prompt}</p>
                {(() => {
                  // #2458 UX#5 — only the LATEST handoff card stays actionable;
                  // an older (superseded) card's prompt is stale, so its button is
                  // disabled rather than re-firing an outdated request.
                  const superseded =
                    !!latestHandoffToolCallId && tool.toolCallId !== latestHandoffToolCallId;
                  return (
                    <button
                      type="button"
                      onClick={() => onOpenBuilder?.(tool.builderHandoff!)}
                      disabled={!onOpenBuilder || superseded}
                      data-testid={superseded ? 'builder-handoff-superseded' : 'builder-handoff-open'}
                      title={superseded ? builderHandoffSupersededTitle : undefined}
                      className="inline-flex w-fit items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {builderHandoffOpenLabel}
                    </button>
                  );
                })()}
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
            {tool.proposedPlan ? (
              <div
                className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2.5"
                data-testid="proposed-plan"
              >
                {/* objectui#12724 — the header names the app the plan builds
                    (`blueprint.app.label`) and, until the user decides, says
                    the plan waits for them. */}
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground/80"
                    data-testid="proposed-plan-title"
                  >
                    <ClipboardList className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {tool.proposedPlan.appLabel
                        ? `${planTitleLabel} · ${tool.proposedPlan.appLabel}`
                        : planTitleLabel}
                    </span>
                  </span>
                  {onSendMessage &&
                  !builtPlanIds.has(tool.toolCallId) &&
                  !approvedPlanIds.has(tool.toolCallId) ? (
                    <span
                      className="ml-auto inline-flex h-5 shrink-0 items-center rounded-md bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                      data-testid="proposed-plan-awaiting"
                    >
                      {planAwaitingLabel}
                    </span>
                  ) : null}
                </div>
                {(() => {
                  // objectui#12724 — the producer's sample-data line
                  // (`planCard.sampleData.line`, 「示例数据 12 条/对象」) takes
                  // the place of the bare "sample data" count bit.
                  const plan = tool.proposedPlan!;
                  const sampleLine = plan.planCard?.sampleData?.line;
                  const bits = countBitsOf(sampleLine ? { ...plan.counts, seedData: 0 } : plan.counts);
                  if (sampleLine) bits.push(sampleLine);
                  return bits.length ? (
                    <span className="text-[11px] text-muted-foreground" data-testid="proposed-plan-counts">{bits.join(' · ')}</span>
                  ) : null;
                })()}
                {tool.proposedPlan.targetApp ? (
                  <span
                    className="inline-flex w-fit items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300"
                    data-testid="proposed-plan-extend"
                    title={tool.proposedPlan.targetApp}
                  >
                    + {extendChip(tool.proposedPlan.targetApp)}
                  </span>
                ) : null}
                {tool.proposedPlan.summary ? (
                  <p className="text-xs text-muted-foreground">{tool.proposedPlan.summary}</p>
                ) : null}
                {tool.proposedPlan.planCard ? (
                  // objectui#12724 — the plan card v2 rows, from `planCard`.
                  <PlanCardObjectRows
                    objects={tool.proposedPlan.planCard.objects}
                    heading={planObjectsLabel}
                  />
                ) : tool.proposedPlan.objects.some((o) => o.fields) ? (
                  // objectui#12724 — one row per object with a chip per
                  // declared field (`blueprint.objects[].fields`).
                  <div className="flex flex-col" data-testid="proposed-plan-objects">
                    <span className="text-[11px] font-medium text-foreground/70">
                      {planObjectsLabel}
                    </span>
                    {tool.proposedPlan.objects.map((o) => (
                      <div
                        key={o.name}
                        className="flex items-start gap-2 border-t border-border/60 py-1.5 first-of-type:border-t-0"
                        data-testid={`proposed-plan-object-${o.name}`}
                      >
                        <span
                          className="w-20 shrink-0 truncate pt-0.5 text-xs font-medium text-foreground"
                          title={o.name}
                        >
                          {o.label || o.name}
                        </span>
                        <div className="flex min-w-0 flex-wrap gap-1">
                          {o.fields ? (
                            o.fields.map((f) => (
                              <span
                                key={f.name}
                                className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 text-[11px] text-foreground/80"
                                title={f.name}
                                data-testid="proposed-plan-field"
                              >
                                {f.label || f.name}
                              </span>
                            ))
                          ) : o.fieldCount > 0 ? (
                            <span className="pt-0.5 text-[11px] text-foreground/40">· {o.fieldCount}</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : tool.proposedPlan.objects.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5" data-testid="proposed-plan-object-chips">
                    {tool.proposedPlan.objects.map((o) => (
                      <span
                        key={o.name}
                        className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11px] text-foreground/80"
                        title={o.name}
                      >
                        <Table2 className="size-3 text-foreground/40" />
                        {o.label || o.name}
                        {o.fieldCount > 0 ? (
                          <span className="text-foreground/40">· {o.fieldCount}</span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                ) : null}
                {(() => {
                  // objectui#12724 — each view with its intent line: from
                  // `planCard.views`, or from the envelope's `viewIntents` when
                  // a producer that predates `planCard` sends only those.
                  const plan = tool.proposedPlan!;
                  const intentRows = plan.planCard ? plan.planCard.views : plan.viewIntents;
                  if (intentRows && intentRows.length > 0) {
                    return (
                      <div className="flex flex-col" data-testid="proposed-plan-views">
                        <span className="text-[11px] font-medium text-foreground/70">
                          {planViewsLabel}
                        </span>
                        {intentRows.map((v) => (
                          <div
                            key={`${v.object}.${v.view}`}
                            className="flex items-start gap-2 border-t border-border/60 py-1.5 first-of-type:border-t-0"
                            title={v.view}
                            data-testid="proposed-plan-view"
                          >
                            <span className="inline-flex h-5 w-24 shrink-0 items-center justify-center truncate rounded-md bg-muted px-1.5 text-[11px] text-foreground/80">
                              {v.label ?? v.view}
                            </span>
                            <span
                              className="min-w-0 pt-0.5 text-[11px] text-foreground/80"
                              data-testid="proposed-plan-view-line"
                            >
                              {v.line}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  // objectui#12724 phase 1 — the views the build creates
                  // (`blueprint.views`), by name, when no intent line is sent.
                  return plan.views && plan.views.length > 0 ? (
                    <div className="flex flex-col gap-0.5" data-testid="proposed-plan-views">
                      <span className="text-[11px] font-medium text-foreground/70">
                        {planViewsLabel}
                      </span>
                      {plan.views.map((v) => (
                        <div
                          key={v.name}
                          className="flex items-start gap-1.5 text-[11px] text-foreground/80"
                          title={v.name}
                          data-testid="proposed-plan-view"
                        >
                          <span className="mt-px shrink-0 text-foreground/40">·</span>
                          <span>{v.label || v.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}
                {/* Assumptions split into ordinary design notes vs. business
                    rules the build is explicitly DEFERRING ("待补 / Not yet
                    built"). The deferred set gets its own labelled, tinted
                    section with an hourglass so a user can't mistake a
                    still-to-come rule for delivered behaviour (improvement 2). */}
                {(() => {
                  const { designNotes, deferred } = classifyAssumptions(
                    tool.proposedPlan!.assumptions,
                  );
                  const posture = tool.proposedPlan!.planCard?.posture;
                  return (
                    <>
                      {designNotes.length > 0 || posture ? (
                        // objectui#12724 — a list, one item per assumption
                        // (`planCard.assumptions`, else `blueprint.assumptions`),
                        // then how the build will land (`planCard.posture.line`,
                        // cloud#2924) as the last item, where the artboard draws it.
                        <div className="flex flex-col gap-0.5" data-testid="proposed-plan-assumptions">
                          <span className="text-[11px] font-medium text-foreground/70">
                            {planAssumptionsLabel}
                          </span>
                          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11px] text-muted-foreground marker:text-foreground/40">
                            {designNotes.map((a, idx) => (
                              <li key={idx}>{a}</li>
                            ))}
                            {posture ? (
                              <li data-testid="proposed-plan-posture" data-posture={posture.mode}>
                                {posture.line}
                              </li>
                            ) : null}
                          </ul>
                        </div>
                      ) : null}
                      {deferred.length > 0 ? (
                        <div
                          className="flex flex-col gap-1 rounded-md border border-dashed border-amber-300 bg-amber-50/60 px-2 py-1.5 dark:border-amber-800/60 dark:bg-amber-950/20"
                          data-testid="proposed-plan-deferred"
                        >
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                            <Hourglass className="size-3.5" />
                            {planDeferredLabel}
                          </span>
                          {deferred.map((a, idx) => (
                            <div
                              key={idx}
                              className="flex items-start gap-1.5 text-[11px] text-amber-900/90 dark:text-amber-200/90"
                            >
                              <span className="mt-px shrink-0 text-amber-500/80">·</span>
                              <span>{a}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  );
                })()}
                {tool.proposedPlan.questions.length > 0 ? (
                  <div
                    className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 dark:border-amber-900/50 dark:bg-amber-950/30"
                    data-testid="proposed-plan-questions"
                  >
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                      <HelpCircle className="size-3.5" />
                      {planQuestionsLabel}
                    </span>
                    {tool.proposedPlan.questions.map((q, idx) => {
                      // One-click answer chips when the backend derived options
                      // for this exact question; otherwise the user types a reply.
                      const choice = tool.proposedPlan!.questionChoices?.find((c) => c.text === q);
                      return (
                        <div key={idx} className="flex flex-col gap-1">
                          <div className="flex items-start gap-1.5 text-[11px] text-amber-900/90 dark:text-amber-200/90">
                            <span className="mt-px shrink-0">?</span>
                            <span>{q}</span>
                          </div>
                          {onSendMessage && choice && choice.options.length > 0 ? (
                            <div
                              className="flex flex-wrap gap-1 pl-3.5"
                              data-testid="proposed-plan-choice"
                            >
                              {choice.options.map((opt, oi) => (
                                <button
                                  key={oi}
                                  type="button"
                                  onClick={() => onSendMessage(planAnswerMessage(q, opt))}
                                  disabled={planActionsLocked}
                                  className="inline-flex h-6 items-center rounded-full border border-amber-300 bg-background px-2 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40"
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {/* One-click confirm gate: "Build it" sends an approval message
                    (accepting defaults when questions remain), "Adjust" focuses
                    the input so the user types changes. Falls back to a text hint
                    when the host hasn't wired message sending. Once this plan's
                    build has run (issue #432) the actions collapse to a static
                    "Built" badge so it can't be re-triggered. */}
                {onSendMessage ? (
                  builtPlanIds.has(tool.toolCallId) ? (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="proposed-plan-actions">
                      <span
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                        data-testid="proposed-plan-built"
                      >
                        <CheckCircle2 className="size-3.5" />
                        {planBuiltLabel}
                      </span>
                    </div>
                  ) : approvedPlanIds.has(tool.toolCallId) ? (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="proposed-plan-actions">
                      <span
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-muted/40 px-3 text-xs font-medium text-muted-foreground"
                        data-testid="proposed-plan-building"
                      >
                        <Loader2 className="size-3.5 animate-spin" />
                        {planBuildingLabel}
                      </span>
                    </div>
                  ) : (
                  <div
                    className="flex flex-wrap items-center gap-1.5 pt-0.5"
                    data-testid="proposed-plan-actions"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        handlePlanApprove(tool.proposedPlan!.questions.length > 0, tool.toolCallId)
                      }
                      disabled={planActionsLocked}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid="proposed-plan-approve"
                    >
                      <Rocket className="size-3.5" />
                      {planApproveLabel}
                    </button>
                    <button
                      type="button"
                      onClick={handlePlanAdjust}
                      disabled={planActionsLocked}
                      className="inline-flex h-7 items-center rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid="proposed-plan-adjust"
                    >
                      {planAdjustLabel}
                    </button>
                    {/* objectui#12724 — the reply door beside the buttons. */}
                    <span
                      className="text-[11px] text-muted-foreground"
                      data-testid="proposed-plan-reply-hint"
                    >
                      {planApproveHintLabel}
                    </span>
                  </div>
                  )
                ) : (
                  <span className="text-[11px] italic text-muted-foreground/80">
                    {planApproveHintLabel}
                  </span>
                )}
              </div>
            ) : null}
            {/* FALLBACK confirm gate — a propose_blueprint that FINISHED but whose
                result didn't parse into the rich plan card above (a thin/oddly
                shaped envelope, or a prose proposal). Previously this collapsed
                into a "Propose blueprint · Completed" chip and the user was left
                with the assistant's prose telling them to reply "确认" — no
                button, guess-the-phrase. We always give them an explicit, one
                click "Build it" / "Adjust" instead. Same approve/adjust handlers
                and the same #432 built-state collapse as the structured card. */}
            {isUnstructuredBuildProposal(tool) ? (
              <div
                className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2.5"
                data-testid="proposed-plan-fallback"
              >
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
                  <ClipboardList className="size-3.5" />
                  {planTitleLabel}
                </span>
                <p className="text-xs text-muted-foreground">{planReadyLabel}</p>
                {onSendMessage ? (
                  builtPlanIds.has(tool.toolCallId) ? (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="proposed-plan-actions">
                      <span
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                        data-testid="proposed-plan-built"
                      >
                        <CheckCircle2 className="size-3.5" />
                        {planBuiltLabel}
                      </span>
                    </div>
                  ) : approvedPlanIds.has(tool.toolCallId) ? (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="proposed-plan-actions">
                      <span
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-muted/40 px-3 text-xs font-medium text-muted-foreground"
                        data-testid="proposed-plan-building"
                      >
                        <Loader2 className="size-3.5 animate-spin" />
                        {planBuildingLabel}
                      </span>
                    </div>
                  ) : (
                    <div
                      className="flex flex-wrap items-center gap-1.5 pt-0.5"
                      data-testid="proposed-plan-actions"
                    >
                      <button
                        type="button"
                        // No structured questions to default through → plain approve.
                        onClick={() => handlePlanApprove(false, tool.toolCallId)}
                        disabled={planActionsLocked}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="proposed-plan-approve"
                      >
                        <Rocket className="size-3.5" />
                        {planApproveLabel}
                      </button>
                      <button
                        type="button"
                        onClick={handlePlanAdjust}
                        disabled={planActionsLocked}
                        className="inline-flex h-7 items-center rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="proposed-plan-adjust"
                      >
                        {planAdjustLabel}
                      </button>
                    </div>
                  )
                ) : (
                  <span className="text-[11px] italic text-muted-foreground/80">
                    {planApproveHintLabel}
                  </span>
                )}
              </div>
            ) : null}
            {/* Granular confirm-before-change card — a mutating tool that was
                not approved this turn returns status:'changes_proposed' (a
                preview) instead of committing. Same confirm gate as the plan
                card: see the change, then confirm / adjust. Nothing changed
                yet. */}
            {tool.proposedChanges ? (
              <div
                className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2.5"
                data-testid="proposed-changes"
              >
                {isChangePlanV2(tool.proposedChanges) ? (
                  // objectui#12894 — change card v2 (the StudioRailCopilot
                  // artboard), drawn when the envelope carries cloud#2924's
                  // posture: 「修改方案 · N 项」, the posture note, one row per
                  // change. An envelope without it draws the card below, as
                  // before.
                  <ChangePlanBody changes={tool.proposedChanges} verbLabels={changeVerbLabels} />
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
                      <ClipboardList className="size-3.5" />
                      {changesTitleLabel}
                    </span>
                    {tool.proposedChanges.summary ? (
                      <p className="text-xs text-muted-foreground">{tool.proposedChanges.summary}</p>
                    ) : null}
                    <div className="flex flex-col gap-1">
                      {tool.proposedChanges.changes.map((c, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px] text-foreground/80"
                        >
                          <Table2 className="mt-px size-3 shrink-0 text-foreground/40" />
                          <span>{formatChangeRow(c, changeVerbLabels)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {(() => {
                  // objectui#5695 — after 确认修改, the card carries the replay's
                  // verdict instead of going dark. Terminal states render on
                  // EVERY surface (incl. the read-only share page): a UI-owned
                  // failure state is the layer a model cannot narrate over.
                  const outcome = replayOutcomeByProposalId.get(tool.toolCallId);
                  if (outcome?.kind === 'published') {
                    return (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="proposed-changes-actions">
                        <span
                          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                          data-testid="proposed-changes-applied"
                        >
                          <CheckCircle2 className="size-3.5" />
                          {changesAppliedLabel}
                        </span>
                      </div>
                    );
                  }
                  if (outcome?.kind === 'failed') {
                    return (
                      <div className="flex flex-col gap-1 pt-0.5" data-testid="proposed-changes-actions">
                        <span
                          className="inline-flex h-7 w-fit items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
                          data-testid="proposed-changes-failed"
                        >
                          <XCircle className="size-3.5" />
                          {changesFailedLabel}
                        </span>
                        {outcome.error ? (
                          <span className="text-[11px] text-red-700/80 dark:text-red-300/80" data-testid="proposed-changes-failed-reason">
                            {outcome.error}
                          </span>
                        ) : null}
                      </div>
                    );
                  }
                  if (outcome?.kind === 'drafted' && outcome.appliedCard) {
                    // objectui#12894 — the applied card of a change saved as a
                    // draft (cloud#2924): its title and lines as the producer
                    // wrote them, 查看变更并发布 and 撤销.
                    const packageId = outcome.packageId;
                    const discard = discardByToolCall.get(tool.toolCallId);
                    // objectui#12968 — the items this replay drafted preview
                    // through the same door the drafted result's Preview uses.
                    const preview = draftPreviewAction(outcome.items ?? [], packageId, false, {
                      onPreviewDraftApp,
                      onPreviewDraft,
                    });
                    return (
                      <AppliedDraftCard
                        card={outcome.appliedCard}
                        others={outcome.draftState?.others}
                        discard={discard}
                        onPreview={preview?.run}
                        previewLabel={previewDraftLabel}
                        onReview={onReviewDrafts && packageId ? () => onReviewDrafts(packageId) : undefined}
                        onPublish={
                          !onReviewDrafts && onPublishDrafts && packageId
                            ? () => void handlePublishDrafts(packageId)
                            : undefined
                        }
                        publishLabel={publishDraftsLabel}
                        onDiscard={
                          onDiscardDrafts && packageId
                            ? () => void requestDiscardDrafts(tool.toolCallId, packageId, outcome.draftState)
                            : undefined
                        }
                        onDiscardConfirm={
                          onDiscardDrafts && packageId
                            ? () => void runDiscardDrafts(tool.toolCallId, packageId)
                            : undefined
                        }
                        onDiscardCancel={() => setDiscardState(tool.toolCallId, undefined)}
                      />
                    );
                  }
                  if (outcome?.kind === 'drafted') {
                    const preview = draftPreviewAction(outcome.items ?? [], outcome.packageId, false, {
                      onPreviewDraftApp,
                      onPreviewDraft,
                    });
                    return (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="proposed-changes-actions">
                        <span
                          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
                          data-testid="proposed-changes-drafted"
                        >
                          <Clock3 className="size-3.5" />
                          {changesDraftedLabel}
                        </span>
                        {onPublishDrafts && outcome.packageId ? (
                          <button
                            type="button"
                            onClick={() => void handlePublishDrafts(outcome.packageId!)}
                            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                            data-testid="proposed-changes-publish"
                          >
                            <Rocket className="size-3.5" />
                            {publishDraftsLabel}
                          </button>
                        ) : null}
                        {preview ? (
                          <button
                            type="button"
                            onClick={preview.run}
                            className="inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted"
                            data-testid="proposed-changes-preview"
                          >
                            <Eye className="size-3.5" />
                            {previewDraftLabel}
                          </button>
                        ) : null}
                      </div>
                    );
                  }
                  // objectui#7253 — the confirm never reached the server: the AI
                  // quota guardrail refused it with a 429. No replay envelope
                  // will ever arrive for it, so this state is UI-owned, and it
                  // is terminal rather than a rollback to the buttons: clicking
                  // Confirm again buys the same refusal. Ranked below the three
                  // server verdicts above — a real outcome always outranks a
                  // client-side refusal.
                  if (quotaBlockedChanges.has(tool.toolCallId)) {
                    return (
                      <div className="flex flex-col items-start gap-1 pt-0.5" data-testid="proposed-changes-actions">
                        <span
                          className="inline-flex h-7 w-fit items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
                          data-testid="proposed-changes-quota-blocked"
                        >
                          <XCircle className="size-3.5" />
                          {changesFailedLabel}
                        </span>
                        <QuotaBlockedNextStep
                          error={quotaBlockedChanges.get(tool.toolCallId)}
                          onUpgrade={onUpgrade}
                        />
                      </div>
                    );
                  }
                  const applying =
                    outcome?.kind === 'applying' || confirmPendingIds.has(tool.toolCallId);
                  if (applying) {
                    return (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="proposed-changes-actions">
                        <span
                          className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-muted/40 px-3 text-xs font-medium text-foreground/70"
                          data-testid="proposed-changes-applying"
                        >
                          <Loader2 className="size-3.5 animate-spin" />
                          {changesApplyingLabel}
                        </span>
                      </div>
                    );
                  }
                  if (!onSendMessage) {
                    return (
                      <span className="text-[11px] italic text-muted-foreground/80">
                        {changesConfirmHintLabel}
                      </span>
                    );
                  }
                  if (confirmedChangeIds.has(tool.toolCallId)) {
                    // Legacy fallback for hosts whose replay envelope predates
                    // the outcome fields: a later same-tool commit still
                    // collapses the card, just without a verdict.
                    return (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="proposed-changes-actions">
                        <span
                          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                          data-testid="proposed-changes-confirmed"
                        >
                          <CheckCircle2 className="size-3.5" />
                          {changesConfirmedLabel}
                        </span>
                      </div>
                    );
                  }
                  // objectui#10965 — `update_metadata` returns `changes_proposed`
                  // mid-turn, so this card renders while the proposing turn is
                  // still streaming and being stored. Its actions wait on the
                  // same `planActionsLocked` the plan card uses (objectui#10925).
                  return (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="proposed-changes-actions">
                      <button
                        type="button"
                        onClick={() => handleChangesConfirm(tool.toolCallId)}
                        disabled={planActionsLocked}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="proposed-changes-confirm"
                      >
                        <CheckCircle2 className="size-3.5" />
                        {/* objectui#12894 — the envelope's primary action wins
                            over the host's label for `save_draft`, and only
                            then (cloud#2924): the change will be saved as a
                            draft, so the button says 存为草稿. The message it
                            sends is unchanged — it is the approval the
                            cloud confirm gate reads. */}
                        {tool.proposedChanges?.primaryAction === 'save_draft'
                          ? saveDraftLabel
                          : changesConfirmLabel}
                      </button>
                      <button
                        type="button"
                        onClick={handlePlanAdjust}
                        disabled={planActionsLocked}
                        className="inline-flex h-7 items-center rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="proposed-changes-adjust"
                      >
                        {planAdjustLabel}
                      </button>
                    </div>
                  );
                })()}
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
          isPlainSurface
            ? 'flex min-h-0 flex-col overflow-hidden bg-background'
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
                ? 'mx-auto w-full max-w-2xl px-4 py-8 sm:px-0'
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
                const tools = message.toolInvocations ?? [];
                const reasoning = message.reasoning?.trim();
                const sources = message.sources ?? [];
                const buildProgress = !isUser ? message.buildProgress : undefined;
                // The live "Designing…" panel is a hand-off affordance: it
                // yields to the authoritative "Proposed plan" card the instant
                // the propose_blueprint result lands. Suppress it once any tool
                // on this turn carries a structured plan — which also makes it a
                // no-op on reload (only the persisted plan card exists then).
                const blueprintProgress =
                  !isUser && !tools.some((t) => Boolean(t.proposedPlan))
                    ? message.blueprintProgress
                    : undefined;
                const summaryTools =
                  !isUser && processVisibility === 'summary'
                    ? tools.filter(
                        (tool) =>
                          !shouldRenderDetailedTool(tool) &&
                          // While the live design panel is up it already
                          // represents the running propose_blueprint, so don't
                          // also surface that tool's rotating-hint row in the
                          // activity strip (the panel supersedes the
                          // placeholder). With no events the row stays and shows
                          // the placeholder as before.
                          !(blueprintProgress && tool.toolName === 'propose_blueprint'),
                      )
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
                // shown reasoning (only surfaced in debug), no build/design panel.
                const reasoningVisible = processVisibility === 'debug' && Boolean(reasoning);
                const isEmptyAssistantStreaming =
                  !isUser &&
                  Boolean(message.streaming) &&
                  !hasVisibleProse &&
                  summaryTools.length === 0 &&
                  detailedTools.length === 0 &&
                  !reasoningVisible &&
                  !buildProgress &&
                  !blueprintProgress; // a streaming design/build shows its panel, not the dots
                // objectui#10899 — does this turn already SHOW its activity (a
                // tool row, a build/design panel)? Then the quiet 执行过程 note
                // a hydrated tool-call placeholder turn falls back to says
                // nothing the row above it does not, and a reloaded multi-step
                // build printed it under every step. The note stays for a
                // placeholder turn with nothing else on screen (#772).
                // objectui#12724 — the whole-app build's draft tool (its
                // envelope names the package and the `nextSteps`), and whether
                // the build is live: the envelope itself says `published` (an
                // auto-publish environment), or this chat published the draft.
                const builtAppDraft = tools.find(
                  (tool) =>
                    tool.draftReview?.packageId &&
                    tool.draftReview.kind !== 'edit' &&
                    tool.draftReview.items?.some((i) => i.type === 'app'),
                );
                // An auto-publish environment's envelope says `published` and
                // lifts no draft review, so its package is read off the
                // envelope itself (the reader the page's binding uses).
                const publishedBuild = tools.find(
                  (tool) =>
                    parseResultEnvelope(tool.result)?.status === 'published' &&
                    Boolean(detectBuiltAppPackage(tool.result)),
                );
                const builtPackageId =
                  builtAppDraft?.draftReview?.packageId ??
                  (publishedBuild ? detectBuiltAppPackage(publishedBuild.result) : undefined);
                // objectui#12724 — the result card's checklist: the LAST one
                // the turn produced, so a `verify_build` that re-measured the
                // build after a repair supersedes `apply_blueprint`'s.
                let buildChecklist: BuildResultChecklist | undefined;
                if (buildProgress?.phase === 'done') {
                  for (let i = tools.length - 1; i >= 0 && !buildChecklist; i--) {
                    buildChecklist = detectBuildChecklist(tools[i].result);
                  }
                }
                const buildIsLive =
                  publishedBuild !== undefined ||
                  (builtAppDraft !== undefined &&
                    (builtPackageId !== undefined && pendingByPackage.has(builtPackageId)
                      ? pendingByPackage.get(builtPackageId) === 0
                      : publishedToolCalls.has(builtAppDraft.toolCallId)));
                const showsActivity =
                  summaryTools.length > 0 ||
                  detailedTools.length > 0 ||
                  Boolean(buildProgress) ||
                  Boolean(blueprintProgress);
                // objectui#13492 — the answer body in stream order; the
                // streaming cursor rides the last text run, where it sat when
                // the charts always trailed the text.
                const answerBlocks = isUser ? undefined : layoutAnswer(message.content, message.charts);
                let lastTextBlock = -1;
                answerBlocks?.forEach((block, i) => {
                  if (block.kind === 'text') lastTextBlock = i;
                });
                return (
                  <Message key={message.id} from={formatMessageProps(message.role)}>
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
                      {blueprintProgress ? (
                        <BlueprintProgressPanel
                          progress={blueprintProgress}
                          designingLabel={L.designingPlanLabel}
                          extendChip={extendChip}
                          waitingLabel={L.connectionWaiting}
                          stalledLabel={L.connectionStalledLabel}
                          offlineLabel={L.connectionOfflineLabel}
                        />
                      ) : null}
                      {buildProgress ? (
                        <BuildProgressPanel
                          progress={buildProgress}
                          // The build's owning package, from ITS OWN draft
                          // envelope — present on reloaded conversations too,
                          // so the Studio CTA / artifact links never depend on
                          // live-canvas runtime state.
                          appSegment={builtPackageId}
                          live={buildIsLive}
                          nextSteps={builtAppDraft?.draftReview?.nextSteps}
                          checklist={buildChecklist}
                          onOpenBuiltApp={onOpenBuiltApp}
                          openBuiltAppLabel={openBuiltAppLabel}
                          onDesignBuiltApp={onDesignBuiltApp}
                          designBuiltAppLabel={designBuiltAppLabel}
                          getArtifactAction={getArtifactAction}
                          onPreviewDraftApp={onPreviewDraftApp}
                          previewDraftLabel={previewDraftLabel}
                          waitingLabel={L.connectionWaiting}
                          stalledLabel={L.connectionStalledLabel}
                          offlineLabel={L.connectionOfflineLabel}
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
                        ? detailedTools.map(renderToolDetail)
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
                        <RecordLinkContext.Provider value={onOpenRecord ?? null}>
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
                        </RecordLinkContext.Provider>
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

        {readOnly ? null : (
        <div
          ref={promptInputWrapRef}
          className={cn(
            'relative',
            isPlainSurface && 'mx-auto w-full max-w-2xl px-4 pb-4 sm:px-0',
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
          {surfaceContextLabel ? (
            <div className="mb-1 flex" data-testid="surface-context-chip">
              <span
                className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                title={surfaceContextTitle}
              >
                {surfaceContextLabel}
              </span>
            </div>
          ) : null}
          {promptOverlaySlot ? (
            <div className="absolute bottom-full left-0 right-0 z-10 px-3 pb-1">
              {promptOverlaySlot}
            </div>
          ) : null}
          <PromptInput
            accept={acceptedFileTypes}
            fileInputLabel={L.uploadFiles}
            maxFileSize={maxFileSize}
            onSubmit={handleSubmit}
            onError={(e) => {
              // Surface upload-level validation errors via the existing toast/alert path
              console.warn('[plugin-chatbot] prompt-input error', e);
            }}
          >
            {enableFileUpload ? (
              <PromptInputBody>
                <PromptInputAttachments>
                  {(attachment) => <PromptInputAttachment data={attachment} removeLabel={L.removeAttachment} />}
                </PromptInputAttachments>
              </PromptInputBody>
            ) : null}
            <PromptInputTextarea
              placeholder={placeholder}
              disabled={disabled || promptStatus === 'streaming'}
              onChange={
                onInputChange
                  ? (e) => onInputChange(e.currentTarget.value)
                  : undefined
              }
            />
            <PromptInputFooter>
              <PromptInputTools>
                {enableFileUpload ? (
                  <PromptInputActionMenu>
                    <PromptInputActionMenuTrigger />
                    <PromptInputActionMenuContent>
                      <PromptInputActionAddAttachments />
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
                  />
                ) : null}
                {/* #2458 UX#7 — the composer sends on PLAIN Enter (Shift+Enter =
                    newline); the old `⌘` glyph implied Cmd+Enter and misled users.
                    Show the real keys. */}
                <span
                  className="hidden items-center gap-1 text-[10px] text-muted-foreground sm:inline-flex"
                  aria-hidden="true"
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
 * Default rotating hints for the propose_blueprint wait. Presentational
 * reassurance — the call is one atomic LLM request with no partial stream, so
 * these don't reflect real sub-steps; they just let the (tens-of-seconds) wait
 * read as deliberate design work instead of a hang. Order roughly follows how a
 * human would think a schema through, with a few extra later-stage lines so a
 * multi-minute wait keeps showing fresh copy instead of an obvious 5-item loop
 * (improvement 4). Overridable/localizable via the `designingPlanHints` label.
 */
const DEFAULT_DESIGNING_PLAN_HINTS = [
  'Mapping out the data you’ll track…',
  'Shaping objects and their fields…',
  'Connecting related records…',
  'Setting up relationships and lookups…',
  'Planning the screens and views…',
  'Laying out forms and lists…',
  'Adding sensible defaults and validations…',
  'Sketching a dashboard to track it…',
  'Double-checking the structure hangs together…',
  'Pulling the plan together…',
];

/** How long each design-stage hint stays up (ms) before advancing to the next. */
const DESIGNING_HINT_ROTATE_MS = 3500;

/**
 * Which design hint to show after `elapsedMs` of waiting. Pure + deterministic
 * so it can be unit-tested and so the visible stage is a function of the live
 * elapsed clock (improvement 4) rather than a free-running interval.
 *
 * It advances ONE stage every `stepMs`, then CLAMPS on the final hint instead of
 * wrapping back to the start — so a long wait reads as steady forward progress
 * ("…pulling it together" stays up at the end) and never loops back to "mapping
 * data", which would look like it restarted. Returns the 0-based stage index;
 * `-1` when there is nothing to show (empty list). This is presentational
 * staging, NOT a claim of real sub-step progress or a fake percentage.
 */
export function selectDesignHintIndex(
  elapsedMs: number,
  hintCount: number,
  stepMs: number = DESIGNING_HINT_ROTATE_MS,
): number {
  if (hintCount <= 0) return -1;
  if (hintCount === 1) return 0;
  const safeElapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const step = stepMs > 0 ? stepMs : DESIGNING_HINT_ROTATE_MS;
  const stage = Math.floor(safeElapsed / step);
  return Math.min(stage, hintCount - 1);
}

/**
 * Friendly in-progress indicator for the build agent's `propose_blueprint`
 * step. Because that call is a SINGLE long, atomic LLM request (no token
 * stream, no partial results), a bare elapsed timer made it look like the UI
 * might be stuck. This pairs the live `ToolRunningTimer` with a short lead-in
 * ("Designing your app…"), a hint that ADVANCES through the design stages as the
 * wait grows, and a row of step dots filled up to the current stage so the wait
 * visibly "moves forward". The staging is purely presentational — it is NOT
 * claiming real sub-step progress or a percentage; it just clamps on the final
 * stage rather than looping. An empty `hints` array (or a single entry) just
 * pins the lead-in + timer with no rotation or dots.
 */
function BuildProposalProgressHint({
  label,
  hints,
  offlineLabel,
}: {
  label: string;
  hints: string[];
  offlineLabel: string;
}) {
  // Re-read the real elapsed clock once per stage interval; the visible stage is
  // DERIVED from it (via the pure selector) so the hint and the step dots advance
  // off one source of truth. The live seconds timer beside this ticks every 1s on
  // its own, so the strip keeps "moving" between stage changes.
  const [elapsedMs, setElapsedMs] = React.useState(0);
  React.useEffect(() => {
    if (hints.length <= 1) return; // nothing to advance through
    const start = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - start), DESIGNING_HINT_ROTATE_MS);
    return () => clearInterval(id);
  }, [hints.length]);
  const index = selectDesignHintIndex(elapsedMs, hints.length);
  const hint = index >= 0 ? hints[index] : undefined;
  // Show the lightweight step dots only once there are real stages to track and
  // we won't crowd the strip (cap the dot count so a long custom list stays sane).
  const showDots = hints.length > 1 && hints.length <= 12;
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
      data-testid="build-proposal-progress"
      aria-live="polite"
    >
      <Sparkles className="size-3 shrink-0 animate-pulse text-primary" aria-hidden />
      <span className="font-medium text-foreground/80">{label}</span>
      {hint ? (
        // `key` on the hint text restarts the fade each time it swaps, so the
        // stage change reads as a gentle transition rather than an instant flicker.
        <span key={hint} className="truncate animate-in fade-in duration-500">
          {hint}
        </span>
      ) : null}
      {showDots ? (
        <span
          className="hidden shrink-0 items-center gap-0.5 sm:inline-flex"
          data-testid="build-proposal-progress-dots"
          aria-hidden
        >
          {hints.map((_, i) => (
            <span
              key={i}
              className={cn(
                'size-1 rounded-full transition-colors',
                i <= index ? 'bg-primary/70' : 'bg-muted-foreground/25',
              )}
            />
          ))}
        </span>
      ) : null}
      <ToolRunningTimer offlineLabel={offlineLabel} />
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

const BUILD_GROUP_ORDER = ['object', 'view', 'dashboard', 'app', 'seed'];

/**
 * The build tree's per-type row headings, through the pack (objectui#7388).
 *
 * These were a module-level English `Record`, so every row of an otherwise
 * localized panel read "Objects / Views / Dashboards / App / Sample data" in
 * English — the same island the header strings were in, and the more visible
 * half of it (one per row, on every build).
 *
 * The lookup stays a STATIC switch rather than `t('chatbot.build.group.' + type)`:
 * a computed key is invisible to `check-i18n-call-site-keys`, which is the gate
 * that proves each key exists in the `en` pack. The `default` arm keeps the old
 * `?? type` behaviour verbatim — an unknown artifact type renders its raw type,
 * which is honest, and never a raw i18n key.
 */
function useBuildGroupLabel(): (type: string) => string {
  const { t } = useObjectTranslation();
  return React.useCallback(
    (type: string) => {
      switch (type) {
        case 'object':
          return t('chatbot.build.group.object', { defaultValue: 'Objects' });
        case 'view':
          return t('chatbot.build.group.view', { defaultValue: 'Views' });
        case 'dashboard':
          return t('chatbot.build.group.dashboard', { defaultValue: 'Dashboards' });
        case 'app':
          return t('chatbot.build.group.app', { defaultValue: 'App' });
        case 'seed':
          return t('chatbot.build.group.seed', { defaultValue: 'Sample data' });
        default:
          return type;
      }
    },
    [t],
  );
}

/**
 * Live "Designing…" panel for an in-flight blueprint DESIGN (`propose_blueprint`).
 * The plan-design call is a long, atomic LLM request; the server now streams a
 * reconciled `data-blueprint-progress` part as the schema takes shape, so this
 * panel shows objects appearing one-by-one (label + field count) with the
 * summary / extend target revealed progressively — replacing the purely
 * presentational rotating-hint placeholder with real, event-driven progress.
 *
 * It is a LIVE affordance only: the caller stops rendering it the instant the
 * `propose_blueprint` result lands (a structured `proposedPlan` exists on the
 * turn), so the authoritative "Proposed plan" card takes over cleanly. With no
 * progress events (older runtimes / non-streaming turns) this never renders and
 * the rotating-hint placeholder remains — zero regression.
 */
function BlueprintProgressPanel({
  progress,
  designingLabel = 'Designing your app…',
  extendChip,
  waitingLabel = 'Waiting for server…',
  stalledLabel = 'Still working…',
  offlineLabel = 'Connection lost — reconnecting…',
}: {
  progress: ChatBlueprintProgress;
  designingLabel?: string;
  /** objectui#11658 — the localized scope-chip text for a target app (see
   *  `useExtendChip`); the panel owns no wording of its own for it. */
  extendChip: (targetApp: string) => string;
  waitingLabel?: string;
  stalledLabel?: string;
  offlineLabel?: string;
}) {
  const { phase, summary, appLabel, targetApp, objects, counts, seq } = progress;
  const countBitsOf = useMetadataCountBits();
  const isDone = phase === 'done';
  // Real activity key, mirroring BuildProgressPanel: prefer the server's
  // monotonic `seq` (it also advances on keep-alive heartbeats, where the
  // content fields don't change), else a content signature for older runtimes.
  // Drives the liveness indicator off observed bytes so the wait reads as
  // "designing" rather than a hang.
  const activityKey = seq ?? `${phase}:${objects.length}`;
  // At `done` the app's own summary/label is the most informative header; while
  // designing, the localized "Designing your app…" lead-in pairs with the
  // summary shown on its own line below.
  const headerText = isDone ? summary || appLabel || designingLabel : designingLabel;
  const countBits = countBitsOf(counts ?? {});
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm" data-testid="blueprint-progress">
      <div className="mb-2 flex items-center gap-2 font-medium">
        {isDone ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        )}
        <span className="min-w-0 truncate">{headerText}</span>
        {targetApp ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300"
            data-testid="blueprint-progress-extend"
            title={targetApp}
          >
            + {extendChip(targetApp)}
          </span>
        ) : null}
        {!isDone ? (
          <span className="ml-auto shrink-0">
            <LivenessIndicator
              active
              activityKey={activityKey}
              waitingLabel={waitingLabel}
              stalledLabel={stalledLabel}
              offlineLabel={offlineLabel}
            />
          </span>
        ) : null}
      </div>
      {/* Summary one-liner — revealed progressively as the design streams. At
          `done` it's already promoted into the header, so only show it here
          while designing. */}
      {!isDone && (summary || appLabel) ? (
        <p className="mb-2 text-xs text-muted-foreground">{summary || appLabel}</p>
      ) : null}
      {objects.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" data-testid="blueprint-progress-objects">
          {objects.map((o) => (
            // `key` on the stable object name fades each chip in exactly once as
            // it first appears, so the panel reads as objects materialising one
            // by one rather than a list snapping into place.
            <span
              key={o.name}
              className="inline-flex animate-in fade-in items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11px] text-foreground/80 duration-500"
              title={o.name}
            >
              <Table2 className="size-3 text-foreground/40" />
              {o.label || o.name}
              {o.fields ? <span className="text-foreground/40">· {o.fields}</span> : null}
            </span>
          ))}
        </div>
      ) : null}
      {countBits.length > 0 ? (
        <span className="mt-2 block text-[11px] text-muted-foreground">
          {countBits.join(' · ')}
        </span>
      ) : null}
    </div>
  );
}

/**
 * objectui#12724 — the plan card's object rows from `planCard.objects` (the
 * AiBuild artboard): the object's label, one chip per field with the format its
 * sample data is held to in mono type (`format.label`), a dashed 「补充」 chip for
 * a field the user's words did not name (`suggested`), the stage field's
 * lifecycle beside its label (`lifecycle.label`, objectui#12994), and
 * 「名称：FIELD」 under the chips when the object declares its name field
 * (`nameField`). Each of those four is drawn only when its key is present. When
 * the title is composed rather than typed, the producer's own line
 * (`nameField.generated.line`, objectui#13004) is drawn in place of 「名称：FIELD」.
 */
function PlanCardObjectRows({
  objects,
  heading,
}: {
  objects: ProposedPlanCard['objects'];
  heading: string;
}) {
  const { t } = useObjectTranslation();
  const suggestedMark = t('chatbot.plan.suggestedField', { defaultValue: 'suggested' });
  return (
    <div className="flex flex-col" data-testid="proposed-plan-objects">
      <span className="text-[11px] font-medium text-foreground/70">{heading}</span>
      {objects.map((o) => (
        <div
          key={o.name}
          className="flex items-start gap-2 border-t border-border/60 py-1.5 first-of-type:border-t-0"
          data-testid={`proposed-plan-object-${o.name}`}
        >
          <span
            className="inline-flex h-5 w-20 shrink-0 items-center justify-center truncate rounded-md bg-primary/10 px-1.5 text-[11px] font-medium text-primary"
            title={o.name}
          >
            {o.label}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap gap-1">
              {o.fields.map((f) => (
                <span
                  key={f.name}
                  className={cn(
                    'inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px]',
                    f.suggested
                      ? 'border border-dashed border-border text-muted-foreground'
                      : 'bg-muted text-foreground/80',
                  )}
                  title={f.name}
                  data-testid="proposed-plan-field"
                  {...(f.suggested ? { 'data-suggested': 'true' } : {})}
                >
                  {f.label}
                  {f.format ? (
                    <span
                      className="font-mono text-[10.5px] text-muted-foreground"
                      data-testid="proposed-plan-field-format"
                    >
                      {f.format.label}
                    </span>
                  ) : null}
                  {f.lifecycle ? (
                    <span className="text-[10.5px] text-muted-foreground" data-testid="proposed-plan-field-lifecycle">
                      {f.lifecycle.label}
                    </span>
                  ) : null}
                  {f.suggested ? <span>· {suggestedMark}</span> : null}
                </span>
              ))}
            </div>
            {o.nameField ? (
              <span
                className="text-[11px] text-muted-foreground"
                data-testid="proposed-plan-name-field"
                {...(o.nameField.generated ? { 'data-generated': 'true' } : {})}
              >
                {o.nameField.generated
                  ? o.nameField.generated.line
                  : t('chatbot.plan.nameField', { field: o.nameField.label, defaultValue: 'Name: {{field}}' })}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * objectui#12724 — the result card's checklist (the AiBuild artboard's 核对
 * rows): every line the producer measured on the build, objects in one column
 * and views and the sample data in the other, each with its own pass mark.
 * The lines are the producer's words, read verbatim from `checklist.lines`.
 */
function BuildChecklistRows({ checklist }: { checklist: BuildResultChecklist }) {
  const objectLines = checklist.lines.filter((l) => l.kind === 'object');
  const otherLines = checklist.lines.filter((l) => l.kind !== 'object');
  const column = (lines: BuildResultChecklist['lines'], testId: string) =>
    lines.length > 0 ? (
      <ul className="flex flex-col" data-testid={testId}>
        {lines.map((l, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 py-1 text-xs text-foreground/90"
            data-testid="build-checklist-line"
            data-status={l.status}
          >
            {l.status === 'passed' ? (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
            ) : (
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            )}
            <span className="min-w-0">{l.line}</span>
          </li>
        ))}
      </ul>
    ) : null;
  return (
    <div className="@container" data-testid="build-checklist">
      <div className="grid grid-cols-1 gap-x-6 @md:grid-cols-2">
        {column(objectLines, 'build-checklist-objects')}
        {column(otherLines, 'build-checklist-checks')}
      </div>
    </div>
  );
}

/**
 * Live "build tree" for an in-flight app build (apply_blueprint). Renders the
 * artifacts as they stream in (via the message's `buildProgress`), so the user
 * watches objects → views → dashboard → app → sample data appear instead of a
 * blank thinking spinner. Collapses to a "Built X" summary when done.
 */
function BuildProgressPanel({
  progress,
  appSegment,
  onOpenBuiltApp,
  openBuiltAppLabel = 'Open app',
  onDesignBuiltApp,
  designBuiltAppLabel = 'Design in Studio',
  getArtifactAction,
  onPreviewDraftApp,
  previewDraftLabel = 'Preview',
  live = false,
  nextSteps,
  checklist,
  waitingLabel = 'Waiting for server…',
  stalledLabel = 'Still working…',
  offlineLabel = 'Connection lost — reconnecting…',
}: {
  progress: ChatBuildProgress;
  /** The build's owning package id (from its draft envelope), for deep links. */
  appSegment?: string;
  /**
   * objectui#12724 — the turn's latest `checklist` (`apply_blueprint`, then
   * `verify_build` after a repair). When present, the finished card shows its
   * 核对通过 chip and lines in place of the artifact list, and its `app` and
   * `packageId` feed 打开应用 and 在 Studio 中查看.
   */
  checklist?: BuildResultChecklist;
  /**
   * objectui#12724 — the build is published (its envelope says so, or this
   * chat's publish signal does), so the finished card says 「已搭建并上线」.
   * Without that signal it keeps saying only that the app was built.
   */
  live?: boolean;
  /** objectui#12724 — the build envelope's `nextSteps`, for the 「接下来可以说」 line. */
  nextSteps?: string[];
  onOpenBuiltApp?: (appName: string) => void;
  openBuiltAppLabel?: string;
  onDesignBuiltApp?: (appName: string, appSegment?: string) => void;
  designBuiltAppLabel?: string;
  getArtifactAction?: (
    artifact: { type: string; name: string },
    appSegment?: string,
  ) => (() => void) | null;
  onPreviewDraftApp?: (appName: string) => void;
  previewDraftLabel?: string;
  waitingLabel?: string;
  stalledLabel?: string;
  offlineLabel?: string;
}) {
  const { phase, appLabel, items, done, total, seq, verify } = progress;
  // objectui#7388 — every string this panel OWNS goes through the pack. The
  // labels it receives as props (`openBuiltAppLabel`, the connection cues, …)
  // are already localized by the host; these were the island left behind.
  const { t } = useObjectTranslation();
  const groupLabelOf = useBuildGroupLabel();
  const isDone = phase === 'done';
  // objectui#11988 — only the phases the tree draws read as "Building"; any
  // other value is surfaced as a warning, never coerced into one of them.
  const unknownPhase = t('chatbot.build.unknownPhase', { defaultValue: 'Unknown build phase' });
  const isUnknown = !isDone && phase !== 'structure' && phase !== 'data';
  // The unnamed-build stand-in is itself a translated noun phrase, so it can be
  // interpolated into the two header frames the same way a real app label is —
  // one hole per frame, which is what `check-i18n-call-site-keys` checks.
  // objectui#12724 — the checklist's `app.label` names the app the build
  // landed in, so a finished card prefers it to the stream's label.
  const appName =
    checklist?.app?.label ?? appLabel ?? t('chatbot.build.appFallback', { defaultValue: 'your app' });
  // Real activity key: bumps whenever the server streams another build-progress
  // part. Prefer the server's monotonic `seq` (it also advances on the keep-alive
  // heartbeats during long, quiet seed-generation awaits, where the content
  // fields don't change); fall back to the content signature for older runtimes
  // that don't send `seq`. Drives the liveness indicator off observed bytes, so a
  // healthy build reads as "receiving" and a genuine stall as amber.
  const activityKey = seq ?? `${phase}:${done}:${items.length}`;
  // The created `app` artifact (navigation shell) — the natural "open it" target.
  // objectui#12724 — the checklist's `app` says which app 打开应用 opens (the
  // new one, or the existing app an extend build landed in) and its
  // `packageId` which package 在 Studio 中查看 opens; without them the doors
  // read the staged artifacts and the draft envelope, as before.
  const stagedApp = items.find((it) => it.type === 'app');
  const builtApp = checklist?.app ?? stagedApp;
  const studioSegment = checklist?.packageId ?? appSegment;
  const showChecklist = isDone && checklist !== undefined;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : isDone ? 100 : 6;
  const groups = new Map<string, Array<{ name: string; display: string }>>();
  for (const it of items) {
    const arr = groups.get(it.type) ?? [];
    arr.push({ name: it.name, display: it.name.replace(/_sample$/, '') });
    groups.set(it.type, arr);
  }
  const orderedTypes = [
    ...BUILD_GROUP_ORDER.filter((t) => groups.has(t)),
    ...[...groups.keys()].filter((t) => !BUILD_GROUP_ORDER.includes(t)),
  ];
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm" data-testid="build-progress">
      <div className="mb-2 flex items-center gap-2 font-medium">
        {isDone ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
        ) : isUnknown ? (
          <TriangleAlert className="size-4 shrink-0 text-amber-600" />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        )}
        <span data-testid="build-progress-title">
          {isDone
            ? live
              ? t('chatbot.build.builtAndLive', { app: appName, defaultValue: 'Built and live · {{app}}' })
              : t('chatbot.build.built', { app: appName, defaultValue: 'Built {{app}}' })
            : isUnknown
              ? unknownPhase
              : t('chatbot.build.building', { app: appName, defaultValue: 'Building {{app}}…' })}
        </span>
        {!isDone && phase === 'data' ? (
          <span className="text-xs font-normal text-muted-foreground">
            {t('chatbot.build.addingSampleData', { defaultValue: 'adding sample data' })}
          </span>
        ) : null}
        {!isDone ? (
          <span className="ml-auto">
            <LivenessIndicator
              active
              activityKey={activityKey}
              waitingLabel={waitingLabel}
              stalledLabel={stalledLabel}
              offlineLabel={offlineLabel}
            />
          </span>
        ) : null}
        {showChecklist ? (
          // objectui#12724 — 核对通过 passed/total, as the checklist counts it.
          <span
            className={cn(
              'ml-auto inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-medium',
              checklist.status === 'passed'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
            )}
            data-testid="build-checklist-chip"
            data-status={checklist.status}
          >
            {t('chatbot.build.checksPassed', {
              passed: checklist.passed,
              total: checklist.total,
              defaultValue: 'Checks passed {{passed}}/{{total}}',
            })}
          </span>
        ) : null}
      </div>
      {/* objectui#12724 — a finished build is a result card, not a progress bar. */}
      {!isDone ? (
        <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      {showChecklist ? (
        // objectui#12724 — a finished build with a checklist shows what was
        // verified on it, not the list of staged artifacts.
        <BuildChecklistRows checklist={checklist} />
      ) : (
      <ul className="space-y-1">
        {orderedTypes.map((type) => {
          const entries = groups.get(type)!;
          return (
            <li key={type} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
              <span className="min-w-0 text-muted-foreground">
                <span className="font-medium text-foreground">{groupLabelOf(type)}</span>{' '}
                {entries.slice(0, 6).map((entry, i) => {
                  // Deep-link the artifact to its direct-edit home (Studio
                  // pillar) once the build is done — the host decides which
                  // types are linkable (null → plain text). Mid-build stays
                  // plain: half-built artifacts have nowhere stable to land.
                  const action = isDone
                    ? getArtifactAction?.({ type, name: entry.name }, appSegment)
                    : null;
                  return (
                    <React.Fragment key={entry.name}>
                      {i > 0 ? ', ' : null}
                      {action ? (
                        <button
                          type="button"
                          onClick={action}
                          className="rounded-sm text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                          data-testid={`build-artifact-link-${type}-${entry.name}`}
                        >
                          {entry.display}
                        </button>
                      ) : (
                        entry.display
                      )}
                    </React.Fragment>
                  );
                })}
                {entries.length > 6
                  ? ` ${t('chatbot.build.moreArtifacts', {
                      n: entries.length - 6,
                      defaultValue: '+{{n}} more',
                    })}`
                  : ''}
              </span>
            </li>
          );
        })}
      </ul>
      )}
      {verify ? (
        // The verification line advances per hop and closes on `done`.
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" data-testid="build-verify" title={verify.tool}>
          {verify.phase === 'done' ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
          ) : verify.phase === 'verify' ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <TriangleAlert className="size-3.5 shrink-0 text-amber-600" />
          )}
          {verify.phase === 'done'
            ? t('chatbot.build.verified', { defaultValue: 'Checked the change' })
            : verify.phase === 'verify'
              ? t('chatbot.build.verifying', { defaultValue: 'Checking the change…' })
              : unknownPhase}
          {verify.phase === 'verify' && verify.hop !== undefined
            ? ` ${t('chatbot.build.verifyStep', { n: verify.hop, defaultValue: 'step {{n}}' })}`
            : null}
        </div>
      ) : null}
      {isDone && builtApp && (onDesignBuiltApp || onOpenBuiltApp || onPreviewDraftApp) ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* objectui#12724 (the AiBuild artboard, ruled by the maintainer):
              the finished card's PRIMARY action opens the built app (its
              first navigation item); Studio is the secondary door. Both are
              in-app navigations the user chooses — nothing navigates on its
              own when a build lands. A host without onOpenBuiltApp puts
              Studio in the primary slot. */}
          {onOpenBuiltApp ? (
            <button
              type="button"
              onClick={() => onOpenBuiltApp(builtApp.name)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              data-testid="build-progress-open-app"
            >
              {openBuiltAppLabel}
              <ArrowRight className="size-3.5" />
            </button>
          ) : null}
          {onDesignBuiltApp ? (
            <button
              type="button"
              onClick={() => onDesignBuiltApp(builtApp.name, studioSegment)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium',
                onOpenBuiltApp
                  ? 'border hover:bg-muted'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
              data-testid="build-progress-design-app"
            >
              {designBuiltAppLabel}
            </button>
          ) : null}
          {/* ADR-0037: see the drafted app as-if-published, before Publish. */}
          {onPreviewDraftApp && stagedApp ? (
            <button
              type="button"
              onClick={() => onPreviewDraftApp(stagedApp.name)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted"
              data-testid="build-progress-preview-app"
            >
              <Eye className="size-3.5" />
              {previewDraftLabel}
            </button>
          ) : null}
        </div>
      ) : null}
      {isDone && builtApp ? (
        // objectui#12724 — what to say next (the envelope's `nextSteps`) and
        // the posture of every later change, under the finished build.
        <p
          className="mt-3 border-t pt-2.5 text-xs text-muted-foreground"
          data-testid="build-result-footer"
        >
          {nextSteps && nextSteps.length > 0 ? (
            <span data-testid="build-result-next-steps">
              {t('chatbot.build.nextStepsLead', {
                steps: nextSteps
                  .map((step) => t('chatbot.build.nextStepQuote', { step, defaultValue: '“{{step}}”' }))
                  .join(' '),
                defaultValue: 'Next, you can say: {{steps}}',
              })}{' '}
            </span>
          ) : null}
          <span data-testid="build-result-posture">
            {t('chatbot.build.draftPosture', {
              defaultValue: 'Later changes are saved as drafts, and you publish them in Studio.',
            })}
          </span>
        </p>
      ) : null}
    </div>
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
 * tool fold into one step with a count. The phase is named for the build tool
 * the turn called (`propose_blueprint` designs the plan, `apply_blueprint`
 * builds); any other turn's line opens on its step count. The rows open on their
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
  const names = phaseTools.map((tool) => tool.toolName);
  const phaseLabel = names.includes('apply_blueprint')
    ? t('chatbot.phase.build', { defaultValue: 'Build' })
    : names.includes('propose_blueprint')
      ? t('chatbot.phase.design', { defaultValue: 'Design the plan' })
      : undefined;
  const headline = [
    ...(phaseLabel ? [phaseLabel] : []),
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
  designingPlanLabel: string;
  designingPlanHints: string[];
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
              // A running tool (e.g. "Propose blueprint") shows a LIVE elapsed
              // timer instead of a static "Running", and a red offline cue if
              // the network drops (issue #432). The build agent's plan-design
              // step is special-cased: that one call is a long, atomic LLM
              // request with no token stream, so a bare timer felt stuck — give
              // it a friendly "Designing your app…" lead-in with rotating hints.
              group.rawName === 'propose_blueprint' ? (
                <BuildProposalProgressHint
                  label={labels.designingPlanLabel}
                  hints={labels.designingPlanHints}
                  offlineLabel={labels.connectionOfflineLabel}
                />
              ) : (
                <ToolRunningTimer offlineLabel={labels.connectionOfflineLabel} />
              )
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
  return (
    <div className="border-t bg-background px-3 py-2 text-sm" role="alert" data-testid="chat-send-error">
      <div className="rounded-md border border-amber-300/40 bg-amber-50/60 px-3 py-2 text-foreground dark:bg-amber-950/20">
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 break-words leading-snug">{text}</div>
        </div>
      </div>
    </div>
  );
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
 */
function useAiQuotaCopy(error: unknown): { text: string; cta: string } | null {
  const { language } = useObjectTranslation();
  const tt = useSafeTranslate();
  const quota = React.useMemo(() => parseAiQuotaError(error), [error]);
  if (!quota) return null;
  const isZh = language.toLowerCase().startsWith('zh');
  return {
    text:
      (isZh ? quota.message : quota.messageEn ?? quota.message) ||
      tt('chatbotQuota.fallbackMessage', 'You have reached your AI quota.'),
    cta: quota.topUp
      ? tt('chatbotQuota.buyCredits', 'Buy a credit pack')
      : tt('chatbotQuota.upgradePlan', 'Upgrade plan'),
  };
}

/**
 * The next step under a confirm card that a quota refusal blocked
 * (objectui#7253): what happened (the server's own sentence — it names both
 * exits, "resets tomorrow" and "upgrade to keep designing") and, when the host
 * wired one, the upgrade action. Renders nothing when the blocking error is not
 * a quota refusal, so the badge above it degrades to a bare "not applied"
 * rather than to an invented explanation.
 */
function QuotaBlockedNextStep({
  error,
  onUpgrade,
}: {
  error: unknown;
  onUpgrade?: () => void;
}) {
  const copy = useAiQuotaCopy(error);
  if (!copy) return null;
  return (
    <>
      <span
        className="text-[11px] leading-snug text-muted-foreground"
        data-testid="proposed-changes-quota-reason"
      >
        {copy.text}
      </span>
      {onUpgrade ? (
        <button
          type="button"
          onClick={onUpgrade}
          className="inline-flex h-7 items-center rounded-md border border-amber-400/50 bg-background px-2 text-xs font-medium text-amber-700 hover:bg-amber-100/60 dark:text-amber-300"
          data-testid="proposed-changes-quota-upgrade"
        >
          {copy.cta}
        </button>
      ) : null}
    </>
  );
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

  // AI quota refusal (429 from the cloud token guardrail) -> friendly upgrade /
  // top-up CTA instead of a red "Response failed" banner. Copy resolved by the
  // shared helper, which the confirm card's blocked state reads too.
  if (quota) {
    const { text, cta } = quota;
    const title = tt('chatbotQuota.title', 'Upgrade needed');
    return (
      <div className="border-t bg-background px-3 py-2 text-sm" role="alert">
        <div className="rounded-md border border-amber-300/40 bg-amber-50/60 px-3 py-2 text-foreground dark:bg-amber-950/20">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium leading-snug text-foreground">{title}</div>
              <div className="mt-0.5 break-words leading-snug text-muted-foreground">{text}</div>
            </div>
            {onUpgrade ? (
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
