/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Where the conversation holds an AI question, and when that question is
 * still waiting for its answer (question-card topic, Q2b).
 *
 * A question is a question tool's result whose envelope
 * (`parseAskQuestionEnvelope`, `@objectstack/spec/ai`) ended the turn: its
 * `reply` is the plain text the turn ended with. The answer is the next user
 * message; nothing here is turn state.
 *
 * A "segment" is the run of assistant messages between two user messages. A
 * tool-ended turn arrives in two shapes: streamed it is ONE assistant message
 * (tool parts plus text), reloaded it is TWO (one carrying the tool parts, one
 * carrying the text). Both are one segment, so both read the same.
 *
 * Pure functions over the rendered message list, so the card, the in-thread
 * summary and the regenerate button all read one answer.
 */
import { parseAskQuestionEnvelope, type AskQuestionEnvelopeParsed } from '@objectstack/spec/ai';
import { parseResultEnvelope } from '../toolResultParsers';
import { isToolCallPlaceholder } from './answerLayout';
import type { ChatbotEnhancedMessage, ChatbotEnhancedToolInvocation, ToolDecisionState } from './types';

/** A question the conversation holds. */
export interface ChatQuestion {
  /** The question tool call's id: the question's identity (skip marks key on it). */
  toolCallId: string;
  envelope: AskQuestionEnvelopeParsed;
  /** The message whose text is the envelope's `reply`: where the question is drawn. */
  messageId: string;
}

/** What the composer knows beside the message list. */
export interface PendingQuestionContext {
  /** A message the user typed during the turn waits to be sent. */
  queued?: boolean;
  /** Question tool-call ids the user skipped on this device. */
  skipped?: ReadonlySet<string>;
  /** A read-only transcript (a share page): it has no composer to replace. */
  readOnly?: boolean;
  /** The host's approval decisions, by tool-call id (`ChatbotEnhancedProps.toolDecisions`). */
  toolDecisions?: Record<string, ToolDecisionState>;
}

/**
 * The stream statuses a chat reports (the AI SDK's `ChatStatus`). A question
 * is pending only once the stream has ended.
 */
export type ChatStreamStatus = 'submitted' | 'streaming' | 'ready' | 'error';

function questionOf(tool: ChatbotEnhancedToolInvocation): AskQuestionEnvelopeParsed | null {
  if (tool.errorText || tool.result === undefined) return null;
  if (tool.state && tool.state !== 'output-available') return null;
  const envelope = parseResultEnvelope(tool.result);
  return envelope ? parseAskQuestionEnvelope(envelope) : null;
}

function isShownText(message: ChatbotEnhancedMessage): boolean {
  const text = message.content.trim();
  return text.length > 0 && !isToolCallPlaceholder(text);
}

/** The segments of a message list: the assistant runs, each with its start index. */
function segmentsOf(messages: readonly ChatbotEnhancedMessage[]): Array<{ start: number; end: number }> {
  const segments: Array<{ start: number; end: number }> = [];
  let start = 0;
  messages.forEach((message, index) => {
    if (message.role !== 'user') return;
    if (index > start) segments.push({ start, end: index });
    start = index + 1;
  });
  if (messages.length > start) segments.push({ start, end: messages.length });
  return segments;
}

/**
 * The question one segment ended on, or `null`. The segment holds exactly one
 * question result, and that result's `reply` equals the segment's last shown
 * assistant text, at or after the result. That excludes two questions in one
 * batch, another tool or text ending the turn after the question, and a turn
 * whose text is not the question's.
 */
function questionInSegment(
  messages: readonly ChatbotEnhancedMessage[],
  start: number,
  end: number,
): ChatQuestion | null {
  let found: { toolCallId: string; envelope: AskQuestionEnvelopeParsed; index: number } | null = null;
  let count = 0;
  let lastText: { message: ChatbotEnhancedMessage; index: number } | null = null;
  for (let i = start; i < end; i += 1) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    for (const tool of message.toolInvocations ?? []) {
      const envelope = questionOf(tool);
      if (!envelope) continue;
      count += 1;
      found = { toolCallId: tool.toolCallId, envelope, index: i };
    }
    if (isShownText(message)) lastText = { message, index: i };
  }
  if (count !== 1 || !found || !lastText || lastText.index < found.index) return null;
  if (lastText.message.content.trim() !== found.envelope.reply.trim()) return null;
  return { toolCallId: found.toolCallId, envelope: found.envelope, messageId: lastText.message.id };
}

/** Every question the conversation holds, oldest first (at most one per segment). */
export function findQuestions(messages: readonly ChatbotEnhancedMessage[]): ChatQuestion[] {
  const questions: ChatQuestion[] = [];
  for (const { start, end } of segmentsOf(messages)) {
    const question = questionInSegment(messages, start, end);
    if (question) questions.push(question);
  }
  return questions;
}

function hasPendingApproval(
  messages: readonly ChatbotEnhancedMessage[],
  start: number,
  decisions: Record<string, ToolDecisionState> | undefined,
): boolean {
  for (let i = start; i < messages.length; i += 1) {
    for (const tool of messages[i].toolInvocations ?? []) {
      if (tool.state !== 'approval-requested') continue;
      const decision = decisions?.[tool.toolCallId];
      if (!decision || decision.state === 'pending') return true;
    }
  }
  return false;
}

/**
 * The question waiting for an answer, or `null`. A question is pending only
 * while ALL hold:
 * 1. the stream has ended;
 * 2. the last segment (no user message after it, a HITL continuation
 *    included) ended on a question (`findQuestions`' rule);
 * 3. no message typed during the turn is queued — it is sent, and sending
 *    something else is a skip;
 * 4. no write approval waits in the same segment — the approval card comes
 *    first;
 * 5. the user has not skipped it on this device;
 * 6. the transcript is not read-only.
 */
export function findPendingQuestion(
  messages: readonly ChatbotEnhancedMessage[],
  status: ChatStreamStatus,
  context: PendingQuestionContext = {},
): ChatQuestion | null {
  if (status === 'submitted' || status === 'streaming') return null;
  if (context.readOnly || context.queued) return null;
  if (messages.some((message) => message.streaming)) return null;
  const segments = segmentsOf(messages);
  const last = segments[segments.length - 1];
  if (!last || last.end !== messages.length) return null;
  const question = questionInSegment(messages, last.start, last.end);
  if (!question) return null;
  if (context.skipped?.has(question.toolCallId)) return null;
  if (hasPendingApproval(messages, last.start, context.toolDecisions)) return null;
  return question;
}
