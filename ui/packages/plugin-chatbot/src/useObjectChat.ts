/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useDisplayLocale } from '@object-ui/i18n';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { generateUniqueId } from './utils';
import { emitAiUsageRefresh } from './aiUsageEvents';
import { uiMessagesToChatMessages } from './mapMessages';
import { toRuntimeRole, toRuntimeTimestamp } from './chatMessageAdapter';
import type { SeamChatMessage, SeamToolInvocation } from './chatMessageAdapter';

/**
 * What `useObjectChat` actually emits — from `messages` and from the
 * `onSend(content, messages)` callback fed from it (objectui#4424).
 *
 * The hook used to declare both as the `@object-ui/types` AUTHORING contract.
 * In local mode that was true; in API mode it was a cast over values produced
 * by the RUNTIME mapper, so the declared type was narrower than the values in
 * exactly the direction that hides capability: anyone rebuilding a message
 * field-by-field from its declared type deleted the HITL approval card, the
 * "Review N changes" affordance, the proposed-plan card, the build panel and
 * the inline charts, with the compiler agreeing.
 *
 * This type is what the survey found to be true of BOTH modes — neither the
 * authoring type nor the runtime type, but the shape that admits both:
 *
 *   - **wide where local mode is wide.** An authored `'tool'` role and the
 *     legacy `'partial-call'`/`'call'`/`'result'` tool states reach this
 *     surface unchanged and are folded only at the render seam, which is the
 *     decision `chatMessageAdapter.ts` records. So the runtime type would have
 *     been a lie about local mode.
 *   - **wide where API mode is wide.** The AI SDK's three approval states
 *     (`approval-requested`, `approval-responded`, `output-denied`) are
 *     runtime-only — the authoring contract refuses them (objectui#10018) —
 *     but API mode produces them, so its tool invocations carry them. So the
 *     authoring type would have been a lie about API mode.
 *   - **narrow where BOTH modes are narrow.** `timestamp` is `string`, never
 *     `Date`: API mode never produces one and local mode absorbs it in
 *     `normalizeMessages` before it is ever handed out. Declaring `Date` here
 *     asks every consumer to handle a value that cannot arrive.
 *   - **plus the render-only keys API mode really carries** —
 *     `buildProgress`, `blueprintProgress`, `charts`, and the HITL /
 *     draft-review / proposed-plan / builder-handoff extensions on each tool
 *     invocation.
 *
 * ⚠️ It is NOT a subtype of `@object-ui/types`' `ChatMessage` (objectui#10018).
 * It was one until the authoring `state` union shed the three runtime-only
 * approval states; the values did not change, the authoring contract did. So a
 * host `onSend` callback that declares its parameter as the authoring
 * `ChatMessage[]` no longer type-checks — it was being handed states that
 * contract refuses. Declare it as `ObjectChatMessage[]`. `ChatbotSchema.onSend`
 * (the schema's runtime slot, forwarded here by the three renderers) is typed
 * with the authoring shape widened by exactly those three states, and this type
 * is assignable to it.
 */
export type ObjectChatMessage = Omit<SeamChatMessage, 'timestamp'> & {
  /**
   * Always a string here (or absent). Both modes absorb an authored `Date`
   * via `toRuntimeTimestamp` before emitting — see `chatMessageAdapter.ts`.
   */
  timestamp?: string;
};

// The usage-indicator refresh seam lives in the side-effect-free
// `./aiUsageEvents` so `@object-ui/plugin-chatbot/core` can serve it without
// this hook's `@ai-sdk/react` closure (objectui#13410); re-exported unchanged.
export { AI_USAGE_REFRESH_EVENT, emitAiUsageRefresh } from './aiUsageEvents';

/** An error from {@link sendAwareFetch}: a chat POST rejected before streaming. */
export interface SendFailure extends Error {
  /** HTTP status when a response was received (e.g. 429); absent on network errors. */
  status?: number;
  /** Always true — the request never produced a reply, so nothing was sent. */
  notSent?: boolean;
}

/**
 * `fetch` for the chat transport that turns a REJECTED request into a tagged
 * error. The Vercel AI SDK otherwise hands `onError` a bare Error whose message
 * is the response body and DROPS the HTTP status — so the UI can't tell a 429
 * rate-limit (nothing streamed: restore the input, say "slow down") apart from a
 * mid-stream transport drop (the turn may have completed server-side: reconcile
 * it, don't re-run). We tag:
 *   - `notSent: true` whenever the POST was rejected (non-2xx) or the network
 *     failed, i.e. no assistant tokens ever arrived;
 *   - `status` with the HTTP code when there was a response.
 * The body text is preserved as the Error message so `parseAiQuotaError` (the
 * cloud quota guardrail's friendly JSON) keeps working. Exported for tests.
 */
export async function sendAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (err) {
    // Network failure: the request never reached the server (or no response came
    // back), so the message was not sent.
    const e: SendFailure = err instanceof Error ? err : new Error(String(err));
    e.notSent = true;
    throw e;
  }
  if (!response.ok) {
    // Non-2xx (429 rate-limit, 5xx, …): rejected before any reply streamed.
    let body = '';
    try {
      body = await response.text();
    } catch {
      /* body unavailable — fall back to status text */
    }
    const e: SendFailure = new Error(
      body || response.statusText || `Request failed with status ${response.status}`,
    );
    e.status = response.status;
    e.notSent = true;
    throw e;
  }
  return response;
}

/**
 * Stamp a stable per-turn idempotency key (ADR-0013 D1) onto the outgoing
 * request body, derived from the id of the user message that triggered the
 * turn. On Retry the AI SDK re-sends the SAME triggering user message
 * (regenerate-message keeps the trailing user turn), so its id — and thus the
 * turnId — is identical across the original send and the retry. The server
 * dedups the inbound user message by (conversationId, turnId) and
 * short-circuits a completed turn instead of re-running tools / replanning.
 *
 * Used as `DefaultChatTransport.prepareSendMessagesRequest`. IMPORTANT: when
 * that hook returns a `body`, the SDK sends it VERBATIM — the default body
 * (`id`/`messages`/`trigger`/`messageId`) is NOT merged in. So we must
 * reconstruct exactly what the default transport would send and only ADD
 * `turnId`; otherwise the server receives no `messages` array (400).
 *
 * Exported for unit testing.
 */
export function withTurnId(req: {
  id?: string;
  body?: Record<string, unknown>;
  messages: Array<{ id: string; role: string }>;
  trigger?: unknown;
  messageId?: string;
}): { body: Record<string, unknown> } {
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
  return {
    body: {
      // Replicate the transport's default body (see HttpChatTransport.sendMessages)…
      ...(req.body ?? {}),
      id: req.id,
      messages: req.messages,
      trigger: req.trigger,
      messageId: req.messageId,
      // …then add the per-turn idempotency key.
      ...(lastUser ? { turnId: lastUser.id } : {}),
    },
  };
}

/**
 * ADR-0057 P4 / cloud#817 — merge a handed-off `ask` conversation id into a
 * request body's `context` (the object the agent chat route reads as
 * `AgentChatContext`), returning a NEW body so the cached transport body is
 * never mutated. The build agent redeems `context.parentConversationId` on its
 * first turn to seed the ask thread as context. Exported for unit testing.
 */
export function withHandoffContext(
  body: Record<string, unknown>,
  parentConversationId: string,
): Record<string, unknown> {
  const ctx = (body.context ?? {}) as Record<string, unknown>;
  return { ...body, context: { ...ctx, parentConversationId } };
}

/**
 * One initial message — the seam's INPUT shape ({@link SeamChatMessage}), not
 * the authoring one (objectui#10018).
 *
 * The two callers hand in different things: the schema renderer passes
 * `schema.messages` (authored), and app-shell passes the output of
 * `hydratedMessagesToChatMessages` — RUNTIME values restored from server
 * history, which carry the AI SDK's approval states and the render-only keys.
 * The authoring `ChatMessage` refuses those approval states, so it cannot type
 * the second caller; the seam's input admits both, and the authoring shape is
 * assignable to it, so no authored caller is affected.
 */
type InitialMessage = SeamChatMessage & {
  /**
   * Pre-built chat-runtime parts, handed through to the store untouched when
   * present. Declared as {@link SdkChatMessage}'s own part array — DERIVED, so
   * a runtime bump moves it — rather than as the `Array<Record<string,
   * unknown>>` it used to be (objectui#8426).
   *
   * ⚠️ **BREAKING for a host that passes `parts`.** `Record<string, unknown>`
   * admitted every object, including the ones the store cannot hold, and the
   * mismatch was absorbed by a cast at the `useChat` call instead of being
   * reported here. Nothing in this repository sets this member (the schema
   * renderer passes `schema.messages`, and app-shell passes the output of
   * `hydratedMessagesToChatMessages`, whose literal declares no `parts`), so
   * the narrowing is visible only to external hosts — which is exactly the
   * population it protects.
   */
  parts?: SdkChatMessage['parts'];
  reasoning?: string;
};

/**
 * Configuration options for useObjectChat hook.
 */
export interface UseObjectChatOptions {
  /**
   * Backend API endpoint for streaming chat.
   * When provided, uses @ai-sdk/react useChat for SSE streaming.
   * When absent, operates in local/legacy mode.
   */
  api?: string;
  /**
   * Initial messages to populate the chat.
   */
  initialMessages?: InitialMessage[];
  /**
   * Conversation ID for multi-turn context.
   */
  conversationId?: string;
  /**
   * ADR-0057 P4 / cloud#817 — id of the source `ask` conversation handed off to
   * the Builder ("Open in Builder →"). Sent as `context.parentConversationId` on
   * the FIRST turn only (consumed once, then cleared), so the build agent starts
   * with the ask thread as context; the backend redeems it and never re-reads it
   * on later turns (client owns history from there).
   */
  parentConversationId?: string;
  /**
   * System prompt for the assistant.
   */
  systemPrompt?: string;
  /**
   * AI model identifier.
   */
  model?: string;
  /**
   * Whether streaming is enabled.
   * @default true
   */
  streamingEnabled?: boolean;
  /**
   * Additional headers to send with API requests.
   */
  headers?: Record<string, string>;
  /**
   * Additional body parameters for each API request.
   */
  body?: Record<string, unknown>;
  /**
   * Error callback.
   */
  onError?: (error: Error) => void;
  /**
   * Show timestamps on messages.
   */
  showTimestamp?: boolean;

  // --- Legacy/demo mode options ---
  /**
   * Enable local auto-response (legacy/demo mode). Ignored when `api` is set.
   */
  autoResponse?: boolean;
  /**
   * Auto-response text for legacy/demo mode.
   */
  autoResponseText?: string;
  /**
   * Auto-response delay in ms for legacy/demo mode.
   * @default 1000
   */
  autoResponseDelay?: number;
  /**
   * External send callback (fires for both modes).
   *
   * `messages` is the thread as it will be after this send, in the same shape
   * the hook's own `messages` uses — see {@link ObjectChatMessage}. Declare the
   * parameter as `ObjectChatMessage[]`: that is also what lets you READ the
   * render-only keys. ⚠️ A callback that declares it as `@object-ui/types`'
   * authoring `ChatMessage[]` no longer type-checks (objectui#10018) — the
   * emitted shape can carry the three runtime-only approval states that the
   * authoring contract refuses, so it is not a subtype of it.
   */
  onSend?: (content: string, messages: ObjectChatMessage[]) => void;
}

/**
 * Return type of useObjectChat.
 */
export interface UseObjectChatReturn {
  /**
   * Current chat messages — see {@link ObjectChatMessage} for why this is
   * neither the authoring nor the runtime `ChatMessage` (objectui#4424).
   */
  messages: ObjectChatMessage[];
  /** Whether the assistant is currently generating a response */
  isLoading: boolean;
  /** Current error, if any */
  error: Error | undefined;
  /** Send a new user message */
  sendMessage: (content: string, files?: File[]) => void;
  /** Stop the current streaming response */
  stop: () => void;
  /** Reload / retry the last assistant message */
  reload: () => void;
  /** Clear all messages */
  clear: () => void;
  /**
   * ADR-0013 D2: re-hydrate the thread (API mode only); undefined in local mode.
   *
   * Deliberately loose, and — since objectui#8342 — honest about it. The
   * parameter stays `unknown[]` because this package will not republish
   * `@ai-sdk/react`'s pinned `UIMessage` on its own surface; that is the same
   * call objectui#8214 made one file over for `AnyPart.state`. Parameters are
   * CONTRAVARIANT, so this declaration used to be a lie: the value handed out
   * was the SDK's own `setMessages`, which accepts only its `UIMessage[]`, and
   * the only thing stopping `tsc` from saying so was a `chatResult as any`
   * inside the hook.
   *
   * What the implementation now guarantees, which is what makes the
   * declaration a promise it keeps: the hook wraps the SDK function and CHECKS
   * every element before handing the array on. A value that is not a chat
   * message — not an object, or missing a string `id`, a
   * `'user' | 'assistant' | 'system'` role, or a `parts` array — is REFUSED
   * LOUDLY: the call throws a `TypeError` naming the offending index, and the
   * SDK's store is left untouched, because the whole array is checked before
   * anything is written.
   *
   * Refusing rather than FILTERING is the contract, on purpose. This is a
   * re-hydration path: the caller's statement is "the thread is now exactly
   * these messages". Dropping the elements that failed would install a SHORTER
   * thread with no way for the caller to notice — the return type is `void` —
   * which is the same silent-deletion failure objectui#4424 was graded on. The
   * one in-repo consumer, `@object-ui/app-shell`'s `useReconcileOnError`,
   * already calls this inside a `try`/`catch` that falls through to the
   * ordinary error banner, so a refusal degrades to "show the error" instead of
   * to a quietly-truncated transcript.
   *
   * Note the surface accepts an ARRAY only. The SDK's own `setMessages` also
   * takes an updater callback; this member never advertised one and still
   * does not.
   */
  setMessages?: (messages: unknown[]) => void;
  /** Whether the hook is operating in API (streaming) mode */
  isApiMode: boolean;
  /** Input value (controlled by the hook for API mode) */
  input: string;
  /** Set input value */
  setInput: (value: string) => void;
  /** Handle input change event */
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

/**
 * Normalize an OUI ChatMessage[] from schema into internal format.
 *
 * The `Date` -> ISO absorption is NOT restated here: it is the authoring ->
 * runtime seam's decision and lives in `toRuntimeTimestamp`
 * (`chatMessageAdapter.ts`, objectui#4399), which this function consumes. It
 * still applies at this point because the hook's own `messages` output — and
 * the `onSend(content, messages)` callback fed from it — has always handed
 * hosts an ISO string rather than a `Date`; one expression, two consumers.
 * Since objectui#4424 the return type SAYS so, which is the half of the
 * statement that used to be missing.
 *
 * Roles are deliberately NOT narrowed here: an authored `'tool'` message keeps
 * its authored role for the whole of the hook's surface and is folded to
 * `'assistant'` only at the render seam. That is precisely why the honest
 * output type is not the runtime one — see {@link ObjectChatMessage}.
 */
function normalizeMessages(msgs?: SeamChatMessage[]): ObjectChatMessage[] {
  return (msgs ?? []).map((msg, idx) => ({
    id: msg.id || `msg-${idx}`,
    role: msg.role || 'user',
    content: msg.content || '',
    timestamp: toRuntimeTimestamp(msg.timestamp),
    metadata: msg.metadata,
    streaming: msg.streaming,
    toolInvocations: msg.toolInvocations,
  }));
}

/**
 * The message element the PINNED `@ai-sdk/react` `setMessages` accepts,
 * DERIVED from that function rather than restated. No SDK type is named here,
 * so a version bump that moves `UIMessage` moves this alias with it and the
 * published `UseObjectChatReturn['setMessages']` never has to move at all —
 * which is precisely why objectui#8342 was ruled option B and not option A.
 */
type SdkChatMessage = Extract<
  Parameters<ReturnType<typeof useChat>['setMessages']>[0],
  readonly unknown[]
>[number];

/**
 * Is `value` a chat message the SDK's store can hold?
 *
 * Checks exactly the three members `UIMessage` REQUIRES and every SDK read
 * path dereferences: a string `id`, one of the three roles, and a `parts`
 * array. `parts` is checked for array-ness only, NOT element by element — the
 * part union is open (a custom `data-...` part carries an author-defined
 * payload, `UIDataTypes = Record<string, unknown>`), so there is no closed set
 * to check against and restating the union would be exactly the SDK-coupling
 * objectui#8342's ruling declined. `mapMessages.ts`'s `AnyPart` is the same
 * decision on the inbound side; this is its outbound mirror.
 */
function isSdkChatMessage(value: unknown): value is SdkChatMessage {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as { id?: unknown; role?: unknown; parts?: unknown };
  return (
    typeof msg.id === 'string' &&
    (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') &&
    Array.isArray(msg.parts)
  );
}

/**
 * Narrow an arbitrary `unknown[]` to what the SDK's `setMessages` takes, or
 * refuse loudly — see {@link UseObjectChatReturn.setMessages} for why refusing
 * beats filtering on this path. The array is fully checked BEFORE the caller's
 * value can reach the store, so a refusal leaves the thread exactly as it was.
 *
 * The result is built by pushing values the type predicate has already
 * narrowed; there is deliberately no assertion here, because an `as` would
 * just move objectui#8342's defect one line over.
 */
function narrowToSdkChatMessages(messages: unknown[]): SdkChatMessage[] {
  if (!Array.isArray(messages)) {
    throw new TypeError(
      `useObjectChat: setMessages expects an array of chat messages, received ${typeof messages}.`,
    );
  }
  const narrowed: SdkChatMessage[] = [];
  messages.forEach((message, index) => {
    if (!isSdkChatMessage(message)) {
      throw new TypeError(
        `useObjectChat: setMessages received a value at index ${index} that is not a chat ` +
          `message (it needs a string \`id\`, a 'user' | 'assistant' | 'system' \`role\` and ` +
          `a \`parts\` array). Nothing was written; the thread is unchanged.`,
      );
    }
    narrowed.push(message);
  });
  return narrowed;
}

/**
 * One element of the part array {@link SdkChatMessage} carries — DERIVED from
 * that alias for the same reason it is itself derived: no chat-runtime type is
 * named here, so a version bump that moves the part union moves this with it.
 */
type SdkMessagePart = SdkChatMessage['parts'][number];

/**
 * The TOOL arm of that union.
 *
 * The runtime's tool part is a mapped type over its tool set; that set is open
 * (`Record<string, …>`), so the map collapses to an index signature and the
 * arm's discriminant is the template `tool-${string}`. ⇒ a DYNAMIC tool name is
 * fully expressible, which is the thing objectui#8426 was feared to be blocked
 * on and which was measured false before this builder was written.
 */
type SdkToolPart = Extract<SdkMessagePart, { type: `tool-${string}` }>;

/** One warning per (state, tool) pair — see {@link warnApprovalStateWithoutEnvelope}. */
const warnedApprovalWithoutEnvelope = new Set<string>();

/**
 * An invocation claims an approval state with no envelope to back it. Decide
 * whether that is a producer bug worth telling the author about.
 *
 * ⛔ It is NOT, when the invocation carries a `pendingActionId`: an ObjectStack
 * HITL approval is carried by that id and by the `{ status: 'pending_approval' }`
 * tool result, never by the chat runtime's own envelope, and
 * `mapMessages.extractToolInvocations` RE-PROMOTES the state from that same
 * result on the way back out. So the approval card survives the round trip
 * through the derived arm, and there is nothing to report.
 */
function reportUnbackedApprovalState(tool: SeamToolInvocation): void {
  if (tool.pendingActionId) return;
  warnApprovalStateWithoutEnvelope(tool.state ?? 'approval', tool.toolName);
}

/**
 * Tell an author once that an invocation claims an approval state it cannot
 * back up.
 *
 * The chat runtime makes the `approval` envelope REQUIRED alongside
 * `approval-requested`, `approval-responded` and `output-denied`: a value that
 * claims one of those states without it is not a constructible part, so there
 * is no faithful thing to build. This is NOT a tolerated dialect (AGENTS.md
 * #0.1) — the producer is wrong and is told so; the state is then derived from
 * the data the invocation DOES carry so the turn still renders.
 *
 * The authoring `state` union has shed these three runtime-only states
 * (objectui#10018), so a schema AUTHOR can no longer declare one — but this
 * branch is NOT unreachable, and stays. The builder's input is not the
 * authoring face alone: `initialMessages` also carries RUNTIME values, and a
 * runtime producer still constructs an approval state with no envelope.
 * app-shell's server-history path — `mergeToolResultsInto` in
 * `useChatConversation.ts` — promotes `approval-requested` from an ObjectStack
 * pending-action tool result that carries no SDK envelope, and
 * `hydratedMessagesToChatMessages` hands it here. That is the HITL case
 * {@link reportUnbackedApprovalState} stays silent for; any OTHER envelope-less
 * claim is a runtime producer's bug and is reported here.
 */
function warnApprovalStateWithoutEnvelope(state: string, toolName: string): void {
  const key = `${state}:${toolName}`;
  if (warnedApprovalWithoutEnvelope.has(key)) return;
  warnedApprovalWithoutEnvelope.add(key);
  console.warn(
    `[@object-ui/plugin-chatbot] tool invocation \`${toolName}\` declares state ` +
      `\`${state}\` with no \`approval\` envelope. The chat runtime requires the ` +
      'envelope alongside that state, so the invocation is not representable as ' +
      'authored and its state was derived from the data instead. Fix it at the ' +
      'producer: carry `approval.id` (plus `approved` for `approval-responded` ' +
      'and `output-denied`) beside the state (objectui#8426).',
  );
}

/**
 * The arm to build when the declared state is absent, or is an approval state
 * with no envelope to back it: read it off the data the invocation carries.
 *
 * `input-available` is the floor rather than "no state at all" because the
 * runtime's tool part has no state-less arm — every arm carries one. It is
 * also the honest reading of "input, no output yet", and `mapMessages` already
 * promotes a dangling `input-*` in non-live history to a terminal state, so a
 * reloaded conversation does not show it spinning.
 */
function deriveSdkToolPart(tool: SeamToolInvocation, type: `tool-${string}`): SdkToolPart {
  const { toolCallId } = tool;
  const input = tool.args;
  if (tool.errorText !== undefined) {
    return { type, toolCallId, state: 'output-error', input, errorText: tool.errorText };
  }
  if (tool.result !== undefined) {
    return { type, toolCallId, state: 'output-available', input, output: tool.result };
  }
  return { type, toolCallId, state: 'input-available', input };
}

/**
 * Build ONE discriminated tool part from one chat tool invocation.
 *
 * This is objectui#8426's clause of the chain's ruling: the producer
 * CONSTRUCTS the discriminated shape, so the `as any` that used to sit on the
 * `messages` option at the `useChat` call below is no longer load-bearing and
 * is gone. Two consequences worth naming, because both were measured rather
 * than assumed:
 *
 *   - **`toolName` is not copied across.** It is an excess property on a
 *     `tool-*` part (only the dynamic-tool arm declares one) AND it is dead on
 *     this path: the round-trip reader in `mapMessages.ts` derives the name by
 *     stripping the `tool-` prefix off `type`, and reads a part's `toolName`
 *     only for a `dynamic-tool` part. Dropping it is behaviour-preserving.
 *   - **the legacy authoring states are FOLDED, not passed through.**
 *     `partial-call` / `call` / `result` are not runtime states; passing them
 *     through left `isToolState` in `mapMessages.ts` refusing them, so the
 *     invocation came back with no state at all. Folding them onto the
 *     lifecycle arm each one means is what the authoring contract's own doc
 *     says they map to.
 */
function toSdkToolPart(tool: SeamToolInvocation): SdkToolPart {
  const type: `tool-${string}` = `tool-${tool.toolName}`;
  const { toolCallId, approval } = tool;
  const input = tool.args;

  switch (tool.state) {
    case 'approval-requested':
      // `approved` and `reason` are `?: never` on this arm — an OUTSTANDING
      // request has neither, so neither is copied across even if a producer
      // put one there.
      if (approval) {
        return {
          type,
          toolCallId,
          state: 'approval-requested',
          input,
          approval: {
            id: approval.id,
            isAutomatic: approval.isAutomatic,
            signature: approval.signature,
          },
        };
      }
      reportUnbackedApprovalState(tool);
      break;
    case 'approval-responded':
      // The decision itself is what this state MEANS, so an envelope without
      // one does not back it either.
      if (approval && typeof approval.approved === 'boolean') {
        return {
          type,
          toolCallId,
          state: 'approval-responded',
          input,
          approval: {
            id: approval.id,
            approved: approval.approved,
            reason: approval.reason,
            isAutomatic: approval.isAutomatic,
            signature: approval.signature,
          },
        };
      }
      reportUnbackedApprovalState(tool);
      break;
    case 'output-denied':
      // This arm pins `approved: false`. An envelope saying `true` contradicts
      // the state it is attached to, so it does not back it up.
      if (approval && approval.approved === false) {
        return {
          type,
          toolCallId,
          state: 'output-denied',
          input,
          approval: {
            id: approval.id,
            approved: false,
            reason: approval.reason,
            isAutomatic: approval.isAutomatic,
            signature: approval.signature,
          },
        };
      }
      reportUnbackedApprovalState(tool);
      break;
    case 'input-streaming':
    case 'partial-call':
      return { type, toolCallId, state: 'input-streaming', input };
    case 'input-available':
    case 'call':
      return { type, toolCallId, state: 'input-available', input };
    case 'output-error':
      // `errorText` is required on this arm. An authored error with no text is
      // still an error: the state is kept and the empty message is the
      // author's own.
      return { type, toolCallId, state: 'output-error', input, errorText: tool.errorText ?? '' };
    case 'output-available':
    case 'result':
      return { type, toolCallId, state: 'output-available', input, output: tool.result };
    case undefined:
      break;
    default: {
      // Exhaustiveness. A state added to the seam's union (the authoring or the
      // runtime vocabulary) lands here and turns this assignment red, instead
      // of silently taking the derived arm.
      const unhandledState: never = tool.state;
      void unhandledState;
      break;
    }
  }

  return deriveSdkToolPart(tool, type);
}

/**
 * useObjectChat – Composable hook for ObjectUI Chatbot.
 *
 * When `api` is provided, delegates to @ai-sdk/react's useChat for
 * SSE streaming, tool-calling, and production-grade chat.
 *
 * When `api` is absent, operates in local/legacy mode with optional
 * auto-response for demos and playground use.
 *
 * The mode is locked on first render to satisfy the Rules of Hooks.
 * If `api` changes after mount, the mode will NOT switch dynamically.
 */
export function useObjectChat(options: UseObjectChatOptions = {}): UseObjectChatReturn {
  const {
    api,
    initialMessages,
    conversationId,
    parentConversationId,
    systemPrompt,
    model,
    streamingEnabled = true,
    headers,
    body,
    onError,
    showTimestamp,
    autoResponse,
    autoResponseText,
    autoResponseDelay = 1000,
    onSend,
  } = options;

  // The time stamped on a local-mode message is a face the user reads under
  // the bubble, so it is formatted in the display locale — a bare
  // `toLocaleTimeString()` used the MACHINE's locale (objectui#9909). Read
  // here, at the top, for the same Rules-of-Hooks reason as the effect below.
  const displayLocale = useDisplayLocale();

  // Lock the mode on first render to satisfy the Rules of Hooks.
  // Conditional hook calls would crash if `api` toggled between renders.
  const modeRef = useRef<'api' | 'local'>(api ? 'api' : 'local');
  const isApiMode = modeRef.current === 'api';

  // Convert OUI messages to vercel/ai v3 UIMessage format for initialMessages.
  //
  // The `role` is FOLDED, not asserted (objectui#8443). Both lines below used to
  // read `as 'user' | 'assistant' | 'system'`, which was wrong twice over:
  //
  //   - at runtime, an authored `role: 'tool'` (legal on the authoring contract,
  //     and deliberately not narrowed by `normalizeMessages`) reached the SDK
  //     store verbatim while DECLARING one of three roles it is not. Measured on
  //     the real `@ai-sdk/react`: the store holds it unchanged, and the SDK's own
  //     downstream entry points then reject it — `convertToModelMessages` throws
  //     `AI_MessageConversionError: Unsupported role: tool` and
  //     `validateUIMessages` throws `AI_TypeValidationError` naming exactly
  //     `["system","user","assistant"]`. Nothing anywhere recognises `'tool'`.
  //   - at compile time, the assertion switched OFF the tripwire the seam exists
  //     to provide: `chatMessageAdapter.ts` records that "a new authored `role`
  //     makes {@link toRuntimeRole} unassignable", so adding a role to the
  //     authoring type is supposed to break here and force someone to handle it.
  //     An `as` let that future role through silently.
  //
  // `toRuntimeRole` is the package's ONE expression of this fold — the named
  // decision of objectui#4399 ("`'tool'` renders as an assistant bubble"), which
  // the render seam already applies. This builder now performs it instead of
  // asserting it, same as objectui#4424 and objectui#8342 each did for one other
  // instance of this class.
  //
  // The array this builds is DECLARED as what the store takes
  // (`SdkChatMessage[]`), and every part is CONSTRUCTED to fit — the
  // objectui#8426 clause of the ruling. The annotation is on the map callback
  // rather than on the `useMemo` alone so a builder branch that stops fitting
  // is reported at the branch that broke, not at the call site that consumes
  // it.
  const aiInitialMessages = useMemo<SdkChatMessage[]>(
    () =>
      (initialMessages ?? []).map((msg, idx): SdkChatMessage => {
        if (Array.isArray(msg.parts) && msg.parts.length > 0) {
          return {
            id: msg.id || `msg-${idx}`,
            role: toRuntimeRole(msg.role || 'user'),
            parts: msg.parts,
          };
        }
        const normalized = normalizeMessages([msg])[0];
        const parts: SdkChatMessage['parts'] = [];
        if (normalized.content) {
          parts.push({ type: 'text', text: normalized.content });
        }
        if (msg.reasoning) {
          parts.push({ type: 'reasoning', text: msg.reasoning });
        }
        for (const tool of normalized.toolInvocations ?? []) {
          parts.push(toSdkToolPart(tool));
        }
        return {
          id: normalized.id || `msg-${idx}`,
          role: toRuntimeRole(normalized.role),
          parts: parts.length > 0 ? parts : [{ type: 'text', text: '' }],
        };
      }),
    // initialMessages is intentionally referenced once on first render only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ADR-0028: the AI SDK caches the transport from the first render, so a
  // mid-session model switch in the picker would never reach the static
  // `body.model` below. Keep the live model in a ref and inject it per-send in
  // prepareSendMessagesRequest (the hook closes over this stable ref).
  const modelRef = useRef(model);
  modelRef.current = model;

  // ADR-0057 P4 / cloud#817 — the handed-off `ask` conversation id, sent as
  // `context.parentConversationId` on the handoff turn: armed here, consumed once
  // in prepare below, then cleared so normal follow-ups don't re-carry it. The
  // backend redeems it into the build turn's context.
  //
  // Re-arm on every falsy→truthy transition of the prop (not on a new VALUE): a
  // SECOND "Open in Builder →" resumes the same singleton build conversation and
  // re-supplies the SAME ask id (the ask thread is a singleton too), so the
  // fresh-arrival signal is the transition, not a changed value. The URL-mirror
  // strips the param after each handoff send, giving the truthy→falsy edge — so
  // a later handoff arms again and its latest ask context re-carries (#2).
  const parentConvRef = useRef(parentConversationId);
  const prevParentConvPropRef = useRef(parentConversationId);
  useEffect(() => {
    const prev = prevParentConvPropRef.current;
    prevParentConvPropRef.current = parentConversationId;
    if (parentConversationId && !prev) parentConvRef.current = parentConversationId;
  }, [parentConversationId]);

  // objectui#4187 - the caller's `body`/`headers` are read through refs at SEND
  // time instead of being closed over by the transport, so they are NOT memo
  // deps below. Every caller passes a fresh object literal each render (the AI
  // page's chat pane rebuilds `body.context` inline), so listing them rebuilt
  // `DefaultChatTransport` on every render of every chat surface - once per
  // token batch during a streaming turn. Same idiom as `modelRef` above, and
  // the only one of the two candidate fixes a future caller cannot silently
  // undo by forgetting its own `useMemo`.
  //
  // SAMPLING CONTRACT (the one real behavioural change): a send serializes
  // whatever these refs hold when `prepareSendMessagesRequest` runs, i.e. the
  // values from the most recent render, spread at SEND time. Before, the values
  // were spread into the transport at CONSTRUCTION time, so a send observed the
  // last render that happened to rebuild it. The ref read is never staler than
  // that and is now unconditional - see `useObjectChat.transportIdentity.test`.
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const headersRef = useRef(headers);
  headersRef.current = headers;

  // Build a transport for API mode that posts to the configured endpoint and
  // forwards conversation/system/model metadata in the request body.
  // Note: conversationId is sent in the body (not a header) to avoid CORS
  // preflight issues with custom headers in cross-origin setups.
  const transport = useMemo(() => {
    if (!isApiMode) return undefined;
    return new DefaultChatTransport({
      api: api!,
      // Tag rejected requests (429 rate-limit / 5xx / network) with status +
      // `notSent` so the composer can restore the input and show a clear error
      // instead of silently dropping the message (see sendAwareFetch).
      fetch: sendAwareFetch,
      // No `headers` here (objectui#4187): the caller's headers are applied
      // per-send in prepareSendMessagesRequest below. `reconnectToStream` does
      // NOT run that hook — it reads this constructor's `headers` — so the first
      // consumer to wire up stream resumption must merge `headersRef.current`
      // into `prepareReconnectToStreamRequest` too, or it will resume without
      // them. Nothing in this repo resumes a stream today.
      body: {
        ...(conversationId ? { conversationId } : {}),
        ...(model ? { model } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(streamingEnabled !== undefined ? { stream: streamingEnabled } : {}),
      },
      // Stamp a stable per-turn idempotency key (ADR-0013 D1). See withTurnId —
      // it reconstructs the full default body (incl. messages) + adds turnId.
      prepareSendMessagesRequest: ({
        id,
        body: reqBody,
        messages,
        trigger,
        messageId,
        headers: reqHeaders,
      }) => {
        // #4187: the caller's live `body` goes in FIRST, so the fixed keys above
        // (conversationId/model/systemPrompt/stream) and any per-send body still
        // win - the same precedence as when it was spread into the transport's
        // own `body` option.
        const req = withTurnId({
          id,
          body: { ...bodyRef.current, ...reqBody },
          messages,
          trigger,
          messageId,
        });
        // ADR-0028: always send the CURRENTLY selected model (see modelRef above)
        // so a mid-session picker switch routes, despite the cached transport.
        if (modelRef.current) (req.body as Record<string, unknown>).model = modelRef.current;
        // ADR-0057 P4 / cloud#817 — carry the handed-off ask conversation id on
        // the FIRST turn only, nested under `context` (where the agent route
        // reads it). Then clear the ref so later turns don't re-send it (the
        // client owns history from there; re-sending re-injects the same block).
        if (parentConvRef.current) {
          req.body = withHandoffContext(req.body as Record<string, unknown>, parentConvRef.current);
          parentConvRef.current = undefined;
        }
        // #4187: the SDK hands us its merged base headers and REPLACES them with
        // whatever we return here, so re-merge instead of replacing. The caller's
        // live headers go in first so a per-send header still overrides them,
        // exactly as the transport's own `headers` option behaved.
        const sendHeaders = new Headers(headersRef.current ?? {});
        new Headers(reqHeaders ?? {}).forEach((value, key) => sendHeaders.set(key, value));
        return { ...req, headers: sendHeaders };
      },
    });
  }, [isApiMode, api, model, systemPrompt, streamingEnabled, conversationId]);

  // --- @ai-sdk/react useChat (always called to satisfy Rules of Hooks, but only active in API mode) ---
  // Ref so `onError` (fired later, async) can reach the live setMessages/messages
  // without re-creating useChat — needed to roll back the optimistic user bubble.
  const chatRef = useRef<any>(null);
  const chatResult = useChat({
    transport,
    // No cast. `aiInitialMessages` is built as `SdkChatMessage[]` and every
    // part is constructed to fit the store's own part union, so this option is
    // CHECKED — which is the whole of objectui#8426 (the last suppression on
    // this call; the blanket `as any` on the options object went with
    // objectui#8378). ⛔ Do not re-widen this call, here or on the options
    // object: a mismatch belongs at the producer above, where the branch that
    // caused it is named.
    messages: isApiMode && aiInitialMessages.length > 0 ? aiInitialMessages : undefined,
    onError: isApiMode
      ? (err: Error) => {
          // The POST was rejected before any reply streamed (see sendAwareFetch).
          // The AI SDK keeps the optimistic user message; drop it so a never-sent
          // turn isn't left looking "sent". The composer restores the text and
          // surfaces the error; reconcile-on-error leaves it unsuppressed.
          if ((err as { notSent?: boolean }).notSent) {
            const chat = chatRef.current;
            const cur = chat?.messages as Array<{ role?: string }> | undefined;
            if (
              chat?.setMessages &&
              cur &&
              cur.length > 0 &&
              cur[cur.length - 1]?.role === 'user'
            ) {
              // The SDK's own `setMessages`, reached through `chatRef` — NOT
              // the narrowed wrapper the hook returns (objectui#8342). The
              // value is the SDK's own live `messages` minus its last element,
              // so it is already `UIMessage[]`; re-checking it here would only
              // pay for a guarantee the source already carries.
              chat.setMessages(cur.slice(0, -1));
            }
            // A rejected send (esp. a 429 quota block) means the usage picture
            // changed — refresh the indicator so it reflects the wall the user
            // just hit (ADR-0057 #8).
            emitAiUsageRefresh();
          }
          onError?.(err);
        }
      : undefined,
  });
  chatRef.current = chatResult;

  // ADR-0057 #8 — refresh the AI usage indicator when a turn finishes. On the
  // loading→ready edge (submitted/streaming → ready) the server has recorded the
  // turn's tokens, so the quota headroom just moved. Declared at top level (before
  // the API-mode early return) to satisfy the Rules of Hooks; inert in local mode
  // (status stays 'ready'). The 429/rejected-send case is handled in onError above.
  const prevChatStatusRef = useRef<string | undefined>(undefined);
  const chatStatus = (chatResult as { status?: string } | undefined)?.status;
  useEffect(() => {
    const prev = prevChatStatusRef.current;
    prevChatStatusRef.current = chatStatus;
    if ((prev === 'streaming' || prev === 'submitted') && chatStatus === 'ready') {
      emitAiUsageRefresh();
    }
  }, [chatStatus]);

  // --- Local/legacy mode state ---
  const [localMessages, setLocalMessages] = useState<ObjectChatMessage[]>(
    () => normalizeMessages(initialMessages)
  );
  const [localIsLoading, setLocalIsLoading] = useState(false);
  const [localInput, setLocalInput] = useState('');
  // API-mode input state (v3 useChat no longer manages it). Declared at top
  // level to satisfy the Rules of Hooks regardless of which mode is active.
  const [apiInput, setApiInput] = useState('');
  const autoResponseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup auto-response timer on unmount
  useEffect(() => {
    return () => {
      if (autoResponseTimerRef.current) {
        clearTimeout(autoResponseTimerRef.current);
        autoResponseTimerRef.current = null;
      }
    };
  }, []);

  // ---- API-mode derived state + callbacks ----
  // `chatResult` (the useChat above) is ALWAYS called; destructure it and
  // declare every callback below unconditionally so the hook calls the same
  // hooks in the same order regardless of `isApiMode` (rules-of-hooks). Only
  // the API return branch consumes these.
  const {
    messages: aiMessages,
    status,
    error,
    sendMessage: aiSendMessage,
    regenerate,
    stop,
    setMessages: aiSetMessages,
  } = chatResult;

  const isLoading = status === 'submitted' || status === 'streaming';

  // Vercel AI SDK v6 UIMessage → the runtime `ChatbotEnhancedMessage`. The
  // shared mapper handles parts (text, reasoning, tool-*, source-*),
  // streaming-cursor flagging, and legacy `msg.toolInvocations` fallback. We
  // splice `metadata` back in because `ChatbotEnhancedMessage` doesn't carry it
  // but the authoring contract does.
  //
  // objectui#4424: this used to end in `as OuiChatMessage[]`, and that cast was
  // the card. It erased `buildProgress`, `blueprintProgress`, `charts` and
  // every HITL / draft-review extension on the tool invocations, because the
  // authoring type declares none of them — the values survived only because
  // nothing downstream rebuilt a message. There is no assertion here now: the
  // mapper's output IS an `ObjectChatMessage`, so the compiler checks the
  // assignment instead of being told to stop looking.
  const apiMessages: ObjectChatMessage[] = uiMessagesToChatMessages(aiMessages, {
    isStreaming: isLoading,
  }).map((m, idx) => ({
    ...m,
    metadata: (aiMessages[idx] as any)?.metadata,
  }));

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const nextMessages: ObjectChatMessage[] = [
        ...apiMessages,
        { id: generateUniqueId('msg'), role: 'user', content: trimmed },
      ];
      aiSendMessage({ text: trimmed });
      setApiInput('');
      onSend?.(trimmed, nextMessages);
    },
    [aiSendMessage, onSend, apiMessages],
  );

  // objectui#8342 — the honest half of the deliberately-loose surface. The
  // published member takes `unknown[]`; the SDK's own `setMessages` takes only
  // its `UIMessage[]`, and parameters are contravariant, so passing the SDK
  // function straight out advertised a capability it does not have. The
  // narrowing happens HERE, which is what turns the declaration into a promise
  // the implementation keeps.
  const setMessages = useCallback(
    (messages: unknown[]) => {
      aiSetMessages(narrowToSdkChatMessages(messages));
    },
    [aiSetMessages],
  );

  const clear = useCallback(() => {
    setMessages([]);
  }, [setMessages]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setApiInput(e.target.value);
    },
    [],
  );

  // ---- Local/legacy mode callbacks ----
  const localStop = useCallback(() => {
    if (autoResponseTimerRef.current) {
      clearTimeout(autoResponseTimerRef.current);
      autoResponseTimerRef.current = null;
    }
    setLocalIsLoading(false);
  }, []);

  const localSendMessage = useCallback((content: string) => {
    if (!content.trim()) return;

    const userMessage: ObjectChatMessage = {
      id: generateUniqueId('msg'),
      role: 'user',
      content: content.trim(),
      timestamp: showTimestamp ? new Date().toLocaleTimeString(displayLocale) : undefined,
    };

    setLocalMessages(prev => {
      const updated = [...prev, userMessage];
      onSend?.(content.trim(), updated);
      return updated;
    });
    setLocalInput('');

    // Auto-response for demo/playground
    if (autoResponse) {
      setLocalIsLoading(true);
      autoResponseTimerRef.current = setTimeout(() => {
        const assistantMessage: ObjectChatMessage = {
          id: generateUniqueId('msg'),
          role: 'assistant',
          content: autoResponseText || 'Thank you for your message!',
          timestamp: showTimestamp ? new Date().toLocaleTimeString(displayLocale) : undefined,
        };
        setLocalMessages(prev => [...prev, assistantMessage]);
        setLocalIsLoading(false);
      }, autoResponseDelay);
    }
  }, [showTimestamp, displayLocale, autoResponse, autoResponseText, autoResponseDelay, onSend]);

  const localReload = useCallback(() => {
    // In local mode, there's no server to retry — no-op
  }, []);

  const localClear = useCallback(() => {
    localStop();
    setLocalMessages([]);
  }, [localStop]);

  const localHandleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setLocalInput(e.target.value);
  }, []);

  // ---- API mode return ----
  // All hooks above run every render; only the returned surface differs by mode.
  if (isApiMode) {
    return {
      messages: apiMessages,
      isLoading,
      error,
      sendMessage,
      stop,
      reload: regenerate,
      clear,
      // ADR-0013 D2: let the host re-hydrate the thread from the server after
      // a stream-transport failure (the reply may already be persisted
      // server-side — reconcile, don't re-run). This is the NARROWING wrapper
      // above, not the SDK function itself: the declared parameter is
      // `unknown[]` and the wrapper is what makes that true (objectui#8342).
      setMessages,
      isApiMode: true,
      input: apiInput,
      setInput: setApiInput,
      handleInputChange,
    };
  }

  // ---- Local/legacy mode return ----
  return {
    messages: localMessages,
    isLoading: localIsLoading,
    error: undefined,
    sendMessage: localSendMessage,
    stop: localStop,
    reload: localReload,
    clear: localClear,
    isApiMode: false,
    input: localInput,
    setInput: setLocalInput,
    handleInputChange: localHandleInputChange,
  };
}
