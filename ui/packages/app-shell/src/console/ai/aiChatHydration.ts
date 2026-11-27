// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Persisted / cached conversation history → the messages `<ChatbotEnhanced>`
 * renders. Split out of `AiChatPage.tsx` move-only (objectstack#37730).
 */

import {
  detectRecordHandoff,
  detectRecordWrite,
  detectAnswerSource,
  detectSampleDataCleanup,
  detectPackageRemoval,
  storedAnswerData,
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
  type ChatbotEnhancedMessage as ChatMessage,
} from '@object-ui/plugin-chatbot';
import { detectPendingApproval } from '@object-ui/plugin-chatbot/core';
import type { HydratedUIMessage, HydratedUIMessagePart } from '../../hooks/useChatConversation.js';

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

export function firstUserMessageText(messages: HydratedUIMessage[]): string | undefined {
  const message = messages.find((item) => item.role === 'user');
  const text = message?.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  return text || undefined;
}
