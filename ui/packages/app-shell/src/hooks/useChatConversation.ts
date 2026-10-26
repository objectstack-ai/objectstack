// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Server-backed AI chat conversation lifecycle.
 *
 * Binds a chat UI to an `ai_conversations` row owned by the signed-in user.
 * On mount it tries the cached id (per user, optionally per scope); falls
 * back to creating a fresh conversation when the cached one is gone
 * (404/403).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
// One parse for one contract. `detectPendingApproval` is the live mapper's own
// reader of the framework HITL envelope, exported (objectui#8442) so this
// hydration path cannot grow a second dialect of it (Commandment #0.1).
// `@object-ui/plugin-chatbot` is already a static member of this package's
// barrel closure (`index.ts` re-exports `AiChatPage`, which imports it), so
// this adds no package edge and no eager bundle weight.
import { detectPendingApproval } from '@object-ui/plugin-chatbot/core';

/** Minimal UIMessage shape compatible with `@ai-sdk/react`'s `useChat`. */
export interface HydratedUIMessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface HydratedUIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: HydratedUIMessagePart[];
}

export interface UseChatConversationOptions {
  /** Authenticated user id; hook is inert until this is defined. */
  userId: string | undefined;
  /**
   * Optional scope (e.g. agent name) for keying separate conversations under
   * the same user.
   */
  scope?: string;
  /**
   * Base URL of the AI service (no trailing slash). Hook calls
   * `${apiBase}/conversations[/...]`. Required.
   */
  apiBase: string;
  /**
   * Explicit conversation id to hydrate. When provided the cache is bypassed
   * and the hook fetches this conversation directly; falls back to creating a
   * fresh one if the server returns 404/403. When omitted the hook keeps its
   * original cache-first / create-on-miss behaviour.
   */
  activeId?: string;
  /**
   * Explicit "start a NEW conversation" intent (the sidebar's New button,
   * `/ai?new=1`). Without it a bare `/ai` visit resumes the last cached
   * conversation — which is right for a plain visit but made the New button a
   * no-op: the resolved-once guard kept the current id and the URL-mirroring
   * effect immediately rewrote `/ai` back to `/ai/:currentId`. When true (and
   * no `activeId`), the cache and the guard are skipped and a fresh
   * conversation is created. Ignored while `activeId` is set.
   */
  forceNew?: boolean;
  /**
   * How a plain visit (no `activeId`, no `forceNew`) treats the cached
   * conversation:
   *   - `'resume'` (default): re-open the last conversation. Right for the full
   *     `/ai` page and the stateful BUILD surface, where losing an in-progress
   *     build (staged drafts, the awaiting-confirm plan) is harmful.
   *   - `'fresh'`: open a clean thread instead. Used by the floating assistant's
   *     ASK/data surface, where each open should feel new. To avoid littering
   *     the history (the list endpoint keeps empty rows — there's no prune), an
   *     UNTOUCHED (zero-message) cached conversation is REUSED rather than
   *     re-created; a cached conversation that the user actually used is left in
   *     history and a fresh one is minted.
   * Ignored when `activeId` or `forceNew` is set.
   */
  resumeMode?: 'resume' | 'fresh';
  /**
   * ADR-0057 Amendment A1.b — migration read for threads keyed under an OLDER
   * scope. When the PRIMARY cache key for `scope` misses on a plain visit (no
   * `activeId`, no `forceNew`), the id cached under `legacyScope` is fetched
   * and offered to {@link adoptLegacy}; on a match it is ADOPTED — written
   * under the NEW scope's cache key and resumed — instead of minting a fresh
   * thread. The legacy key itself is left intact (other product-only surfaces
   * keep resolving through it). No-op without `adoptLegacy`.
   */
  legacyScope?: string;
  /**
   * Predicate deciding whether the `legacyScope` conversation actually belongs
   * to the requesting scope (e.g. "is this build thread bound to package X?").
   * Receives the conversation's hydrated messages — from the server, or from
   * the localStorage message cache when the server returns none (the same
   * cache-fallback the resolve path already uses). Returning false (or the
   * fetch failing) falls through to creating a fresh conversation.
   */
  adoptLegacy?: (messages: HydratedUIMessage[]) => boolean;
}

export interface UseChatConversationReturn {
  conversationId: string | undefined;
  /**
   * The `scope` (agent) the current `conversationId` was resolved under. Lets a
   * host distinguish "this id belongs to the active agent" from "this id is the
   * PREVIOUS agent's, pending re-resolution after a switch" — so it doesn't
   * mirror a stale id onto the new agent's URL.
   */
  conversationScope: string | undefined;
  initialMessages: HydratedUIMessage[];
  isLoading: boolean;
  /** Delete the current conversation + start a fresh one. */
  reset: () => Promise<void>;
  /**
   * Start a NEW conversation WITHOUT deleting the current one (the floating
   * assistant's "New chat" button). Mints a fresh row and switches to it; the
   * prior thread stays in history (reachable from the `/ai` sidebar). Contrast
   * with {@link reset}, which deletes the current conversation first.
   */
  startNew: () => Promise<void>;
  /**
   * ADR-0057 Amendment A1.b "bind on create" — re-key the CURRENT conversation
   * under `newScope` without re-resolving: the id is written to the new scope's
   * cache key and `conversationScope` flips to `newScope` SYNCHRONOUSLY (a ref
   * write, visible to the very next render). Call it right before navigating
   * to the URL that makes the host compute `newScope` as its scope, so the
   * host's `conversationScope === scope` gate (#2450) holds through the
   * transition and the mounted pane never sees a mismatched window (which
   * would remount it mid-stream). The PREVIOUS scope's cache key is left
   * intact — other surfaces still keyed there (dock/FAB) keep resolving.
   * No-op until a conversation is resolved.
   */
  rekeyScope: (newScope: string) => void;
}

/**
 * The subset of plugin-chatbot's `DraftReview` (mapMessages.ts) that the chat's
 * draft/publish + ADR-0038 verification cards are derived from. Mirrored here —
 * rather than imported — to keep this low-level hook free of a `@object-ui/
 * plugin-chatbot` dependency; the round-trip test in
 * `useChatConversation.test.tsx` runs these through the REAL detectors, so any
 * incompatible drift fails CI.
 */
interface CachedDraftReview {
  items: Array<{ type: string; name: string }>;
  summary?: string;
  packageId?: string;
  autoPublishable?: boolean;
  failedCount?: number;
  materialized?: boolean;
  verification?: { errors: number; warnings: number };
  issues?: Array<{ severity: 'error' | 'warning'; code: string; message: string; fix?: string }>;
  nextSteps?: string[];
  /**
   * objectui#10109 — the producer's incremental-edit marker (`apply_edit`
   * answers `kind: 'edit'`). Kept through the cache because an edit's `items`
   * can include the `app` it re-staged: without it a cache-fallback reload
   * reads the edit as a whole-app build.
   */
  kind?: 'edit';
}

/** Mirrors the subset of plugin-chatbot's `ProposedPlan` the "Proposed plan" card needs. */
interface CachedProposedPlan {
  summary?: string;
  objects: Array<{ name: string; label?: string; fieldCount: number }>;
  counts: { objects: number; views: number; dashboards: number; seedData: number };
  questions: string[];
  assumptions: string[];
  targetApp?: string;
}

interface CacheableChatToolInvocation {
  toolCallId: string;
  toolName: string;
  state?: string;
  errorText?: string;
  /**
   * The detect-relevant shapes the live render already derived from the tool
   * result (`uiMessageToChatMessage`). Present on assistant tool invocations
   * that staged a draft (`apply_blueprint` …) or proposed a plan
   * (`propose_blueprint`). We re-serialize these into a COMPACT tool `output`
   * so the cards survive a cache-fallback reload — see
   * `sanitizeChatMessagesForCache`.
   */
  draftReview?: CachedDraftReview;
  proposedPlan?: CachedProposedPlan;
  /** objectui#5695 — the confirm-replay verdict, so the 确认修改 card's terminal
   *  state (已生效 / 已暂存为草稿 / 未生效) survives a cache-fallback reload. */
  replayOutcome?: { kind: 'published' | 'drafted' | 'failed'; outcome?: string; error?: string; packageId?: string; dispatchError?: boolean };
  /**
   * objectui#9232 — the two halves of an ACTIONABLE approval, mirroring
   * objectui#8442 on the way IN to the cache. They travel differently and that
   * asymmetry is the whole design (see `sanitizeChatMessagesForCache`):
   *
   *   * `approval` is the AI SDK envelope and rides the persisted PART, so it
   *     is written back as a part key and read back as one (`partApproval`);
   *   * `pendingActionId` is the ObjectStack `pending_actions` row id, is
   *     never persisted as a part key on ANY path, and is therefore restored
   *     by re-minting the result envelope `detectPendingApproval` re-parses.
   */
  approval?: {
    id: string;
    approved?: boolean;
    reason?: string;
    isAutomatic?: boolean;
    signature?: string;
  };
  pendingActionId?: string;
}

interface CacheableChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  toolInvocations?: CacheableChatToolInvocation[];
}

/**
 * Rebuild the MINIMAL `{ status:'drafted', … }` envelope that
 * `mapMessages.detectDraftResult` re-parses, from the already-derived
 * `DraftReview`. Inverse of the detector: we keep only the fields it reads, so
 * the draft "Review N changes / Publish" card and the ADR-0038 verification
 * chip survive without re-storing the (potentially large) blueprint JSON.
 * `failed` is materialized to the right length because the detector counts
 * `failed.length`.
 */
function draftReviewToCachedResult(dr: CachedDraftReview): Record<string, unknown> {
  return {
    status: 'drafted',
    drafted: dr.items,
    ...(dr.summary ? { summary: dr.summary } : {}),
    ...(dr.packageId ? { packageId: dr.packageId } : {}),
    ...(dr.autoPublishable ? { autoPublishable: true } : {}),
    ...(dr.failedCount ? { failed: Array.from({ length: dr.failedCount }, () => null) } : {}),
    ...(dr.materialized ? { materialized: true } : {}),
    ...(dr.verification ? { verification: dr.verification } : {}),
    ...(dr.issues && dr.issues.length ? { issues: dr.issues } : {}),
    ...(dr.nextSteps && dr.nextSteps.length ? { nextSteps: dr.nextSteps } : {}),
    ...(dr.kind === 'edit' ? { kind: 'edit' } : {}),
  };
}

/**
 * Rebuild the MINIMAL `{ status:'blueprint_proposed', … }` envelope that
 * `mapMessages.detectProposedPlan` re-parses, from the already-derived
 * `ProposedPlan`. Object `fields` are materialized to the right length because
 * the detector reads `fields.length` as the per-object field count — the field
 * definitions themselves are dropped (the lean win).
 */
function proposedPlanToCachedResult(pp: CachedProposedPlan): Record<string, unknown> {
  return {
    status: 'blueprint_proposed',
    ...(pp.summary ? { summary: pp.summary } : {}),
    counts: pp.counts,
    questions: pp.questions,
    ...(pp.targetApp ? { targetApp: pp.targetApp } : {}),
    blueprint: {
      objects: pp.objects.map((o) => ({
        name: o.name,
        ...(o.label ? { label: o.label } : {}),
        fields: Array.from({ length: o.fieldCount }, () => null),
      })),
      assumptions: pp.assumptions,
    },
  };
}

/**
 * Rebuild the MINIMAL replay envelope `mapMessages.detectReplayOutcome`
 * re-parses (objectui#5695). The detector keys off the persisted `replay_*`
 * toolCallId plus these fields; `detectDraftResult` stays quiet over the
 * drafted shapes because they carry no `drafted` items — so a rolled-back
 * publish can never rehydrate from cache as a live draft card.
 */
function replayOutcomeToCachedResult(
  ro: NonNullable<CacheableChatToolInvocation['replayOutcome']>,
): Record<string, unknown> {
  if (ro.kind === 'published') return { status: 'published' };
  // A dispatch error round-trips as the bare `{error}` shape it was detected
  // from, so re-detection keeps its provisional (supersedable) semantics.
  if (ro.kind === 'failed' && ro.dispatchError) return { error: ro.error ?? 'replay dispatch failed' };
  return {
    status: 'drafted',
    ...(ro.packageId ? { packageId: ro.packageId } : {}),
    ...(ro.kind === 'failed'
      ? {
          publishFailed: true,
          ...(ro.outcome ? { publishOutcome: ro.outcome } : {}),
          ...(ro.error ? { publishError: ro.error } : {}),
        }
      : {}),
  };
}

/**
 * Rebuild the MINIMAL HITL envelope `mapMessages.detectPendingApproval`
 * re-parses (objectui#9232). Inverse of that detector, exactly as
 * `draftReviewToCachedResult` is the inverse of `detectDraftResult`.
 *
 * This exists because the id travels asymmetrically. The AI SDK `approval`
 * envelope is a persisted PART key, so the cache can write it and the
 * hydration mapper reads it straight back; `pendingActionId` is not a part key
 * on any path — it lives only inside the tool RESULT — so the only way to
 * round-trip it is to re-mint the envelope the one detector re-parses. A
 * second hand-rolled reader on the cache side would be the second dialect of
 * one contract that Commandment #0.1 refuses.
 *
 * The two keys the detector reads are the only two written: the framework's
 * real envelope also carries a human `message` and the proposed arguments, and
 * none of that is re-serialized — the same leanness the draft/plan inverses
 * take, and the reason a cached thread does not grow a copy of every pending
 * action's payload.
 */
function pendingApprovalToCachedResult(pendingActionId: string): Record<string, unknown> {
  return { status: 'pending_approval', pendingActionId };
}

const CACHE_PREFIX = 'objectstack:ai-chat-conversation-id';
const MESSAGE_CACHE_PREFIX = 'objectstack:ai-chat-messages';

function cacheKey(userId: string, scope?: string): string {
  return scope ? `${CACHE_PREFIX}:${userId}:${scope}` : `${CACHE_PREFIX}:${userId}`;
}

function readCache(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, value: string | undefined): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* ignore — private mode, quota, etc. */
  }
}

function messageCacheKey(conversationId: string): string {
  return `${MESSAGE_CACHE_PREFIX}:${conversationId}`;
}

/**
 * Security — clear ALL cached AI-chat state from localStorage (per-user
 * conversation-id pointers AND per-conversation message bodies). Conversation
 * content + tool payloads are cached in plaintext (keyed by `objectstack:
 * ai-chat-*`); without this, on a shared machine the next profile user could
 * read the previous user's AI threads (which may contain data surfaced by the
 * `ask` agent). Called on a user change / logout (see the hook effect below);
 * also exported so an explicit logout path can invoke it directly.
 */
export function purgeChatCaches(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(CACHE_PREFIX) || key.startsWith(MESSAGE_CACHE_PREFIX))) {
        doomed.push(key);
      }
    }
    doomed.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* ignore — private mode, quota, disabled storage */
  }
}

/**
 * ## Cache-format compatibility — objectui#9232 chose READ-SIDE TOLERANCE
 *
 * objectui#9232 added two keys to what `sanitizeChatMessagesForCache` writes,
 * so entries already in a user's `localStorage` are a short format behind.
 * Three routes were on the table — tolerate them, bump `MESSAGE_CACHE_PREFIX`
 * to a `:v2` key, or discard on read. This path deliberately TOLERATES, and
 * the reasoning is pinned in `useChatConversation.test.tsx` rather than left to
 * be re-derived:
 *
 *   1. Nothing can break on an old entry. The cached payload is a list of OPEN
 *      records (`HydratedUIMessagePart`), and both readers of the new keys
 *      already answer "absent" rather than throwing — `partApproval` returns
 *      undefined for a missing envelope, `detectPendingApproval` returns
 *      undefined for a result that is not one. An old entry restores exactly
 *      as it does today.
 *   2. A version bump or a discard would throw away everything the old writer
 *      got RIGHT — the transcript text, the draft "Review N changes / Publish"
 *      card, the ADR-0038 chip, the proposed plan, the objectui#5695 replay
 *      verdict — to recover one affordance. This cache is only ever read when
 *      the server returned no messages, so the discarded thread is the only
 *      thread the operator would have seen: a strictly worse trade.
 *   3. Old entries self-heal. The cache is rewritten from `runtimeMessages` on
 *      every render, so the first server-backed load after this ships restores
 *      the id through the objectui#8442 path and writes it back in the new
 *      shape. The stale window closes by itself, and only stays open on a
 *      conversation the server cannot serve at all — where there is nothing
 *      better to restore from anyway.
 *
 * What tolerance does NOT do is invent: an old entry keeps `approval-requested`
 * with no id, which is precisely today's behaviour, and no id is fabricated to
 * paper over it. See the objectui#9232 block in the tests.
 */
function readMessageCache(conversationId: string): HydratedUIMessage[] {
  try {
    const raw = localStorage.getItem(messageCacheKey(conversationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((msg): msg is HydratedUIMessage => {
      return (
        Boolean(msg) &&
        typeof msg === 'object' &&
        typeof (msg as { id?: unknown }).id === 'string' &&
        ((msg as { role?: unknown }).role === 'user' ||
          (msg as { role?: unknown }).role === 'assistant' ||
          (msg as { role?: unknown }).role === 'system') &&
        Array.isArray((msg as { parts?: unknown }).parts)
      );
    });
  } catch {
    return [];
  }
}

export function writeConversationMessagesCache(
  conversationId: string | undefined,
  messages: HydratedUIMessage[],
): void {
  if (!conversationId) return;
  try {
    if (messages.length === 0) {
      localStorage.removeItem(messageCacheKey(conversationId));
      return;
    }
    localStorage.setItem(messageCacheKey(conversationId), JSON.stringify(messages));
  } catch {
    /* ignore — private mode, quota, etc. */
  }
}

export function sanitizeChatMessagesForCache(
  messages: CacheableChatMessage[],
): HydratedUIMessage[] {
  return messages
    .map<HydratedUIMessage | undefined>((message) => {
      const parts: HydratedUIMessagePart[] = [];
      if (message.content) {
        parts.push({ type: 'text', text: message.content });
      }
      if (message.role === 'assistant') {
        for (const tool of message.toolInvocations ?? []) {
          // Re-serialize the draft/plan affordance into a compact tool `output`.
          // Without it, a cache-fallback reload (server returns no messages →
          // `readMessageCache`) drops the draft "Review N changes / Publish"
          // card, the ADR-0038 verification chip, and the "Proposed plan" card,
          // because `mapMessages.detect*` read the result `output` that the
          // earlier cache shape never kept. `output` (not a custom part field)
          // is used because the AI SDK preserves it through `useChat` init,
          // exactly as the server-backed tool-result merge relies on.
          //
          // objectui#9232 — the pending-approval arm, and it is LAST on
          // purpose. `state` already survived this rebuild, so a cached
          // `approval-requested` came back carrying nothing to decide with:
          // the operator got Approve / Reject buttons whose only possible
          // outcome was "No pending-action id found for this tool call". That
          // is the divergence objectui#8442 closed on the way OUT of server
          // history, reopened on the way IN to the cache.
          //
          // ⚠️ `output` holds ONE envelope, and an invocation can carry more
          // than one affordance at a time — `draftReview` and `pendingActionId`
          // are independent KEYS on the invocation, not two readings of one
          // result. Putting the pending arm first therefore did not merely
          // reorder equals: it stopped the draft envelope reaching the cache
          // for any turn carrying both, which is the same loss (the "Review N
          // changes / Publish" card on a cache-fallback reload) that the other
          // three arms exist to prevent, and which
          // `AiChatPage.runtimeMessageSeam.test.tsx` already pinned. So the
          // three existing arms keep `output` exactly as before and the
          // pending envelope is minted only when none of them claims it.
          //
          // Losing the id is not the price of that, because the id does NOT
          // depend on `output` alone here — it is also written as a part key
          // below. The two carriers are not redundant; each reaches where the
          // other cannot, and that is the whole design:
          //
          //   * `output` is the only carrier that survives API mode's SDK
          //     store, because `useObjectChat`'s `aiInitialMessages` rebuilds
          //     each part through `toSdkToolPart`, which constructs the chat
          //     runtime's own discriminated tool part — a per-state key set
          //     that carries `output` and has no place for a cache-side key —
          //     and drops every other key, after which
          //     `extractToolInvocations` re-derives the id by re-parsing the
          //     result. A pending-only turn — the only shape API mode can
          //     actually produce, since `detectDraftResult` and
          //     `detectPendingApproval` read ONE `parseResultEnvelope(result)`
          //     and require different `status` values — lands here.
          //   * the PART KEY is the only carrier left when a richer envelope
          //     has taken `output`. Local mode keeps it, because
          //     `normalizeMessages` passes `toolInvocations` through verbatim,
          //     and `hydratedMessagesToChatMessages` lifts it on the way back.
          const cachedOutput = tool.replayOutcome
            ? replayOutcomeToCachedResult(tool.replayOutcome)
            : tool.draftReview
              ? draftReviewToCachedResult(tool.draftReview)
              : tool.proposedPlan
                ? proposedPlanToCachedResult(tool.proposedPlan)
                : tool.pendingActionId
                  ? pendingApprovalToCachedResult(tool.pendingActionId)
                  : undefined;
          parts.push({
            type: `tool-${tool.toolName}`,
            toolCallId: tool.toolCallId,
            toolName: tool.toolName,
            state: tool.state ?? (tool.errorText ? 'output-error' : 'output-available'),
            ...(tool.errorText ? { errorText: tool.errorText } : {}),
            // The SDK envelope rides the PART, both here and on the server
            // path — `partApproval` narrows it straight back off this key.
            ...(tool.approval ? { approval: tool.approval } : {}),
            // The id as a part key — the carrier that survives a taken
            // `output`. It is a CACHE-side supplement, never a rival reading of
            // the framework envelope: `hydratedMessagesToChatMessages` consults
            // `detectPendingApproval` FIRST and only falls back here, so the
            // one contract still decides wherever it has anything to say.
            ...(tool.pendingActionId ? { pendingActionId: tool.pendingActionId } : {}),
            ...(cachedOutput !== undefined ? { output: cachedOutput } : {}),
          });
        }
      }
      if (parts.length === 0) return undefined;
      return {
        id: message.id,
        role: message.role,
        parts,
      };
    })
    .filter((message): message is HydratedUIMessage => Boolean(message));
}

interface ServerMessage {
  id?: string;
  role: string;
  content: unknown;
}

interface ServerConversation {
  id: string;
  messages?: ServerMessage[];
}

function contentToParts(content: unknown): HydratedUIMessagePart[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  if (Array.isArray(content)) {
    return content
      .map<HydratedUIMessagePart | undefined>((part) => {
        if (typeof part === 'string') {
          return part ? { type: 'text', text: part } : undefined;
        }
        if (
          part &&
          typeof part === 'object' &&
          'type' in part &&
          typeof (part as { type?: unknown }).type === 'string'
        ) {
          return part as HydratedUIMessagePart;
        }
        if (
          part &&
          typeof part === 'object' &&
          'text' in part &&
          typeof (part as { text?: unknown }).text === 'string'
        ) {
          return { type: 'text', text: (part as { text: string }).text };
        }
        return undefined;
      })
      .filter((part): part is HydratedUIMessagePart => Boolean(part));
  }
  if (
    content &&
    typeof content === 'object' &&
    'parts' in content &&
    Array.isArray((content as { parts?: unknown }).parts)
  ) {
    return contentToParts((content as { parts: unknown[] }).parts);
  }
  return [];
}

/** Tool-part states that mean "a human still owes this call a decision". */
const APPROVAL_STATES = new Set(['approval-requested', 'approval-responded']);

/**
 * Merge a `tool`-role message's tool-result outputs back onto the assistant
 * tool-call parts that requested them. The server persists conversations in
 * ModelMessage format, where a tool CALL (assistant message) and its RESULT (a
 * separate `tool` row) live in different messages. The chat UI needs the output
 * ON the call part so `detectDraftResult` can rebuild the publish/preview
 * affordances after a reload — otherwise the result, and the whole `tool` row
 * (which the UI never renders directly), is dropped and the build card + publish
 * button vanish on refresh.
 *
 * ⚠️ The state rewrite below is deliberately NARROW (objectui#9233). Collapsing
 * a dangling `input-streaming` / `input-available` into a terminal state is why
 * the rewrite exists and it stays: a snapshot that never recorded the terminal
 * state otherwise shows every tool "Running" forever after a reload. But an
 * APPROVAL state is not a dangling one — it is the state the awaiting-approval
 * card renders on (`isAwaitingApproval` in `ChatbotEnhanced`). Rewriting it here
 * meant a rehydrated pending approval reached the chat as Completed, so the
 * operator got no Approve / Reject card at all even though `useHitlInChat` had
 * the id and `decide()` was live. The arms below are the live mapper's
 * (`mapMessages.extractToolInvocations`), not a second predicate: a pending
 * envelope promotes, an error still wins over it, everything else terminalizes
 * exactly as before.
 */
function mergeToolResultsInto(
  content: unknown,
  byCallId: Map<string, HydratedUIMessagePart>,
): void {
  for (const part of contentToParts(content)) {
    const callId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
    if (!callId) continue;
    const target = byCallId.get(callId);
    if (!target) continue;
    const output =
      (part as { output?: unknown }).output ?? (part as { result?: unknown }).result;
    if (output === undefined) continue;
    target.output = output;
    const errorText = (part as { errorText?: unknown }).errorText;
    const isError = Boolean((part as { isError?: unknown }).isError) || typeof errorText === 'string';
    const baseState = isError ? 'output-error' : 'output-available';
    const heldApproval =
      typeof target.state === 'string' && APPROVAL_STATES.has(target.state)
        ? target.state
        : undefined;
    const approval = detectPendingApproval(output) ? 'approval-requested' : heldApproval;
    target.state = approval && baseState !== 'output-error' ? approval : baseState;
    if (typeof errorText === 'string') target.errorText = errorText;
  }
}

export function toUIMessages(rows: ServerMessage[] | undefined): HydratedUIMessage[] {
  if (!rows) return [];
  const out: HydratedUIMessage[] = [];
  // Index assistant tool-call parts by id so a later `tool`-role result row can
  // merge its output onto the matching call (see mergeToolResultsInto).
  const toolPartByCallId = new Map<string, HydratedUIMessagePart>();
  rows.forEach((row, idx) => {
    const role = row.role as HydratedUIMessage['role'] | 'tool';
    if (role === 'tool') {
      mergeToolResultsInto(row.content, toolPartByCallId);
      return;
    }
    if (role !== 'user' && role !== 'assistant' && role !== 'system') return;
    const parts = contentToParts(row.content);
    if (parts.length === 0) return;
    if (role === 'assistant') {
      for (const part of parts) {
        // ModelMessage format persists an assistant tool CALL as the literal
        // `type:'tool-call'` with the real tool in `toolName`. Left as-is, the
        // chat humanizes the step title to "Call" (and downstream toolName
        // extraction yields "call"). Remap to the AI SDK UI part type
        // `tool-<toolName>` so the step reads "Apply blueprint" / "Propose
        // blueprint" after a clean server-backed reload; the result-merge below
        // and `detect*` are unaffected (they key off toolCallId / output).
        if (part.type === 'tool-call' && typeof part.toolName === 'string' && part.toolName) {
          part.type = `tool-${part.toolName}`;
        }
        const callId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
        if (callId && (part.type === 'tool-call' || part.type.startsWith('tool-'))) {
          toolPartByCallId.set(callId, part);
        }
      }
    }
    out.push({
      id: row.id ?? `msg-${idx}`,
      role,
      parts,
    });
  });
  return out;
}

/**
 * A FLAT `ai_messages` row as returned by the public share endpoint
 * (`GET /api/v1/share-links/:token/messages`), which streams the raw object
 * rows rather than the reconstructed ModelMessage history that the
 * authenticated `GET /conversations/:id` returns.
 */
export interface RawAiMessageRow {
  id?: string;
  role: string;
  /** Persisted text (assistant/user/system) OR a JSON-stringified tool-result array (tool role). */
  content?: unknown;
  /** Assistant tool CALLS, JSON-stringified (`tool-call` parts). */
  tool_calls?: string | null;
  /** Tool RESULT's owning call id (legacy plain-string tool rows). */
  tool_call_id?: string | null;
}

function safeParseArray(value: unknown): Array<Record<string, unknown>> | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reconstruct the ModelMessage-shaped `content` that {@link toUIMessages}
 * expects from the FLAT columns the public share endpoint returns raw.
 *
 * The authenticated path gets this reconstruction server-side
 * (`ObjqlConversationService.toMessage`): an assistant turn's tool CALLS live
 * in the separate `tool_calls` column, and a `tool` row's RESULTS are a
 * JSON-stringified array in `content`. The share endpoint skips that step and
 * dumps the rows verbatim — so the shared transcript previously rendered the
 * raw `{"type":"tool-result",…}` envelope as text instead of a card. Mirroring
 * `toMessage` here lets the share page reuse the exact same hydrate → render
 * pipeline as the live chat. Keep this in lockstep with `toMessage`.
 */
export function aiMessageRowsToServerMessages(rows: RawAiMessageRow[] | undefined): ServerMessage[] {
  if (!rows) return [];
  return rows.map((row) => {
    const id = row.id;
    const text = typeof row.content === 'string' ? row.content : '';
    if (row.role === 'assistant') {
      const toolCalls = safeParseArray(row.tool_calls);
      if (toolCalls && toolCalls.length > 0) {
        const content: Array<Record<string, unknown>> = [];
        if (text) content.push({ type: 'text', text });
        content.push(...toolCalls);
        return { id, role: 'assistant', content };
      }
      return { id, role: 'assistant', content: text };
    }
    if (row.role === 'tool') {
      const results = safeParseArray(row.content);
      if (results && results.length > 0 && results[0]?.type === 'tool-result') {
        return { id, role: 'tool', content: results };
      }
      // Back-compat: pre-array tool rows persisted a plain string.
      return {
        id,
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: row.tool_call_id ?? '',
            toolName: 'unknown',
            output: { type: 'text', value: text },
          },
        ],
      };
    }
    return { id, role: row.role, content: text };
  });
}

export async function fetchConversation(apiBase: string, id: string): Promise<ServerConversation | null> {
  const res = await fetch(`${apiBase}/conversations/${encodeURIComponent(id)}`, {
    credentials: 'include',
  });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`GET conversation failed: ${res.status}`);
  return (await res.json()) as ServerConversation;
}

async function createConversation(apiBase: string): Promise<ServerConversation> {
  const res = await fetch(`${apiBase}/conversations`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`POST conversation failed: ${res.status}`);
  return (await res.json()) as ServerConversation;
}

async function deleteConversation(apiBase: string, id: string): Promise<void> {
  await fetch(`${apiBase}/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  }).catch(() => {
    /* best-effort */
  });
}

export function useChatConversation(
  options: UseChatConversationOptions,
): UseChatConversationReturn {
  const {
    userId,
    scope,
    apiBase,
    activeId,
    forceNew,
    resumeMode = 'resume',
    legacyScope,
    adoptLegacy,
  } = options;
  // Ref'd so the resolve effect reads the LATEST predicate without depending on
  // its identity (hosts pass inline closures; re-resolving on every render of
  // the host would defeat the resolved-once guard).
  const adoptLegacyRef = useRef(adoptLegacy);
  adoptLegacyRef.current = adoptLegacy;
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [initialMessages, setInitialMessages] = useState<HydratedUIMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(userId));
  const mountedRef = useRef(true);
  // Tracks the (user, scope) we have already resolved a no-activeId
  // conversation for. Keyed by SCOPE as well as user so a deliberate agent
  // switch (the `/ai/:agent` launcher changes `scope`) re-resolves under the
  // new agent's cache instead of clinging to the previous agent's conversation,
  // while a no-op re-render under the same scope still short-circuits.
  const resolvedForUserRef = useRef<string | undefined>(undefined);
  const resolvedScopeRef = useRef<string | undefined>(undefined);
  // Last non-transient user we saw, to detect a logout / user switch.
  const prevUserIdRef = useRef<string | undefined>(userId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Security — on a logout or user switch (a previously-known user is now gone
  // or different), wipe the plaintext AI-chat cache so the next person on a
  // shared machine can't read the prior user's threads. A mid-session auth
  // flicker (userId momentarily undefined during a token refresh) would also
  // purge, but that only forces a harmless server re-fetch — the server is the
  // source of truth. The initial mount (prev === userId) never purges.
  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;
    if (prev && prev !== userId) {
      purgeChatCaches();
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setConversationId(undefined);
      setInitialMessages([]);
      setIsLoading(false);
      resolvedForUserRef.current = undefined;
      resolvedScopeRef.current = undefined;
      return;
    }
    // Already resolved a conversation for this (user, scope) during the
    // no-activeId window — don't re-create just because an unrelated dep
    // changed. A `forceNew` intent or a scope (agent) change overrides it.
    const scopeChanged = resolvedScopeRef.current !== scope;
    if (
      !activeId &&
      !forceNew &&
      !scopeChanged &&
      resolvedForUserRef.current === userId &&
      conversationId
    ) {
      return;
    }
    let cancelled = false;
    const key = cacheKey(userId, scope);
    // Drop the previous id NOW, before the async resolve, for both an explicit
    // new-conversation intent AND an agent switch: the host page mirrors
    // `conversationId` into the URL the moment `activeId` is empty, so a stale
    // id left in state would be written onto the new agent's URL (`/ai/:agent`)
    // and then resumed as that agent's conversation.
    if (!activeId && (forceNew || (scopeChanged && resolvedForUserRef.current === userId))) {
      setConversationId(undefined);
      setInitialMessages([]);
    }
    setIsLoading(true);

    (async () => {
      // Which conversation this resolve is FOR, as far as it gets. The catch
      // below needs it to tell "the one we already hold" from "some other id".
      let targetId: string | undefined = activeId;
      try {
        if (activeId) {
          const existing = await fetchConversation(apiBase, activeId);
          if (cancelled) return;
          if (existing) {
            writeCache(key, existing.id);
            setConversationId(existing.id);
            const messages = toUIMessages(existing.messages);
            const next = messages.length > 0 ? messages : readMessageCache(existing.id);
            // A re-resolve of the conversation we ALREADY hold (e.g. the scope
            // prop changed after an A1.b re-key, or the URL-mirror flipped
            // activeId onto the resolved id) can race an in-flight turn: the
            // server persists a turn at COMPLETION, so a mid-stream read
            // returns no history. Never let that empty read wipe hydrated
            // messages we already have for the SAME conversation — a later
            // pane remount would hydrate from this state and render an empty
            // thread. `conversationId` here is the effect-time closure value:
            // exactly "the conversation whose messages we currently hold".
            if (next.length > 0 || existing.id !== conversationId) {
              setInitialMessages(next);
            }
            resolvedForUserRef.current = userId;
            resolvedScopeRef.current = scope;
            return;
          }
          // Requested id is gone — fall through to create a fresh one. The
          // server was DEFINITIVE (404/403), so from here on we are no longer
          // re-reading a conversation worth preserving: drop the catch guard's
          // claim on it, or a failing create below would keep an id we have
          // just been told is dead (and whose caches we just cleared).
          targetId = undefined;
          writeCache(key, undefined);
          writeConversationMessagesCache(activeId, []);
        } else if (!forceNew) {
          const cached = readCache(key);
          targetId = cached;
          // A1.b migration read: nothing cached under THIS scope yet — the
          // thread may predate the scope (e.g. a build conversation keyed
          // product-only before bind-on-create shipped). Offer the legacy
          // scope's conversation to the host's predicate; adopt on match.
          if (!cached && legacyScope && adoptLegacyRef.current) {
            const legacyId = readCache(cacheKey(userId, legacyScope));
            if (legacyId) {
              // Inner try/catch: a failing legacy fetch must degrade to a
              // plain miss (create fresh below), not dead-end the resolve —
              // the outer catch would leave the surface with no conversation
              // where, pre-A1.b, it would have happily created one.
              try {
                const legacy = await fetchConversation(apiBase, legacyId);
                if (cancelled) return;
                if (legacy) {
                  const messages = toUIMessages(legacy.messages);
                  // Server returned no history (it can) → judge the message
                  // cache instead, same fallback the resume path renders from.
                  const judged = messages.length > 0 ? messages : readMessageCache(legacy.id);
                  if (adoptLegacyRef.current?.(judged)) {
                    writeCache(key, legacy.id);
                    setConversationId(legacy.id);
                    setInitialMessages(judged);
                    resolvedForUserRef.current = userId;
                    resolvedScopeRef.current = scope;
                    return;
                  }
                }
              } catch {
                /* treat as a miss — fall through to create */
              }
              if (cancelled) return;
            }
          }
          if (cached) {
            const existing = await fetchConversation(apiBase, cached);
            if (cancelled) return;
            if (existing) {
              const messages = toUIMessages(existing.messages);
              // 'fresh' (the floating ASK surface): only reuse the cached
              // conversation while it's untouched — once the user has actually
              // used it, start a clean thread instead so opening the assistant
              // feels new. Reusing an empty conversation (rather than minting
              // another) keeps repeated opens from littering the history with
              // empty rows. 'resume' (default) re-opens the prior thread.
              const reuse = resumeMode !== 'fresh' || messages.length === 0;
              if (reuse) {
                setConversationId(existing.id);
                setInitialMessages(
                  resumeMode === 'fresh'
                    ? []
                    : messages.length > 0
                      ? messages
                      : readMessageCache(existing.id),
                );
                resolvedForUserRef.current = userId;
                resolvedScopeRef.current = scope;
                return;
              }
              // 'fresh' + a used conversation: fall through to create a fresh
              // one; the used thread stays in history (writeCache below repoints
              // the cache to the new conversation).
              targetId = undefined;
            } else {
              // Definitive miss — same as the activeId 404 above: stop claiming
              // this id, so a failing create cannot preserve a dead one.
              targetId = undefined;
              writeCache(key, undefined);
              writeConversationMessagesCache(cached, []);
            }
          }
        }
        const fresh = await createConversation(apiBase);
        if (cancelled) return;
        writeCache(key, fresh.id);
        setConversationId(fresh.id);
        setInitialMessages(toUIMessages(fresh.messages));
        resolvedForUserRef.current = userId;
        resolvedScopeRef.current = scope;
      } catch {
        if (cancelled) return;
        // objectui#2627 — the OTHER half of the same-conversation guard above.
        // That one stops an EMPTY re-read from wiping hydrated messages; this
        // one stops a FAILED re-read from dropping the conversation itself.
        //
        // The A1.b re-key fires a refetch of the id we already hold at the
        // worst possible moment: the instant a long build turn ends (the bind
        // effect waits for `isLoading` to fall, then re-keys and navigates
        // `?package=`), when the server is still busy finishing that turn. A
        // 5xx/network blip on that one GET landed here, and clearing the id is
        // destructive rather than conservative: the host keys its chat pane on
        // `conversationId ?? 'pending'` (AiChatPage), so `undefined` REMOUNTS
        // the pane, and the live thread — which lives in the chat hook's own
        // instance, not in this state — is discarded. That is the reported
        // "the whole conversation went blank right after the build finished,
        // and only came back after switching threads and back".
        //
        // The id is still valid and the messages we hold are still the truth,
        // so keep both: the surface stays exactly as it was and the next
        // resolve recovers. Only a resolve aimed at a DIFFERENT conversation
        // (a sidebar switch, a forced-new intent) still clears — there the old
        // thread genuinely no longer matches what the URL asks for.
        if (targetId && targetId === conversationId) return;
        setConversationId(undefined);
        setInitialMessages([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `conversationId` intentionally omitted: it's only read inside the
    // short-circuit guard, which is governed by the ref. Including it would
    // re-run the effect after we successfully resolved an id. `adoptLegacy` is
    // read through a ref for the same reason (inline closures would re-resolve
    // every host render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, scope, apiBase, activeId, forceNew, resumeMode, legacyScope]);

  const reset = useCallback(async () => {
    if (!userId) return;
    const key = cacheKey(userId, scope);
    setIsLoading(true);
    try {
      if (conversationId) await deleteConversation(apiBase, conversationId);
      writeConversationMessagesCache(conversationId, []);
      writeCache(key, undefined);
      const fresh = await createConversation(apiBase);
      writeCache(key, fresh.id);
      writeConversationMessagesCache(fresh.id, []);
      if (!mountedRef.current) return;
      setConversationId(fresh.id);
      setInitialMessages([]);
    } catch {
      if (mountedRef.current) {
        setConversationId(undefined);
        setInitialMessages([]);
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [conversationId, userId, scope, apiBase]);

  const startNew = useCallback(async () => {
    if (!userId) return;
    const key = cacheKey(userId, scope);
    setIsLoading(true);
    try {
      // Mint a fresh conversation and switch to it. The current conversation is
      // intentionally NOT deleted — it stays in history (reachable from the
      // `/ai` sidebar), unlike reset(). The remount keyed on `conversationId`
      // in the host clears the visible thread.
      const fresh = await createConversation(apiBase);
      writeCache(key, fresh.id);
      writeConversationMessagesCache(fresh.id, []);
      if (!mountedRef.current) return;
      setConversationId(fresh.id);
      setInitialMessages([]);
      resolvedForUserRef.current = userId;
      resolvedScopeRef.current = scope;
    } catch {
      // Keep the current conversation on failure — better than dropping the
      // user into a broken empty state.
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [userId, scope, apiBase]);

  // A1.b bind-on-create. Synchronous on purpose: the caller invokes this
  // immediately before the navigation that flips its own scope computation to
  // `newScope`, so by the time that navigation's render commits,
  // `conversationScope` (the ref) already agrees with the new scope and the
  // #2450 scope-match gate never opens a remount window. The subsequent
  // resolve-effect run (scope prop changed, `activeId` present) refetches the
  // same id — the same benign refetch the URL-mirror already induces today.
  const rekeyScope = useCallback(
    (newScope: string) => {
      if (!userId || !conversationId) return;
      writeCache(cacheKey(userId, newScope), conversationId);
      resolvedForUserRef.current = userId;
      resolvedScopeRef.current = newScope;
    },
    [userId, conversationId],
  );

  // `resolvedScopeRef` is updated in lockstep with every `setConversationId`
  // (same async tick), so at render time it always describes the scope the
  // current `conversationId` was resolved under.
  return { conversationId, conversationScope: resolvedScopeRef.current, initialMessages, isLoading, reset, startNew, rekeyScope };
}
