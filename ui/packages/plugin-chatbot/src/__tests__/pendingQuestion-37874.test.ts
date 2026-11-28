/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Question-card topic, Q2b — where the conversation holds a question
 * (`findQuestions`) and when the card shows (`findPendingQuestion`), over the
 * two shapes a tool-ended turn arrives in and every condition that holds the
 * card back.
 */
import { describe, expect, it } from 'vitest';
import { findPendingQuestion, findQuestions } from '../chat/pendingQuestion';
import type { ChatbotEnhancedMessage } from '../chat/types';

const REPLY = 'Which revenue did you mean?\n- Booked revenue\n- Invoiced revenue';

const LEGACY_RESULT = {
  success: true,
  status: 'asked_which',
  question: 'Which revenue did you mean?',
  readings: ['Booked revenue', 'Invoiced revenue'],
  reply: REPLY,
};

const ENVELOPE_RESULT = {
  success: true,
  status: 'asked',
  reply: REPLY,
  preface: 'Revenue can be counted two ways.',
  questions: [{
    question: 'Which revenue did you mean?',
    options: [{ label: 'Booked revenue', recommended: true }, { label: 'Invoiced revenue' }],
  }],
};

const USER: ChatbotEnhancedMessage = { id: 'u1', role: 'user', content: 'Show me revenue' };

/** Streamed: ONE assistant message carries the tool part (stream-wrapped) and the text. */
function streamed(result: unknown = LEGACY_RESULT, text = REPLY, toolCallId = 'call_q'): ChatbotEnhancedMessage[] {
  return [
    USER,
    {
      id: 'a1',
      role: 'assistant',
      content: text,
      toolInvocations: [{
        toolCallId,
        toolName: 'ask_which',
        state: 'output-available',
        result: { type: 'text', value: JSON.stringify(result) },
      }],
    },
  ];
}

/** Reloaded: TWO assistant messages, one with the tool part (placeholder text), one with the text. */
function reloaded(result: unknown = LEGACY_RESULT): ChatbotEnhancedMessage[] {
  return [
    USER,
    {
      id: 'a1',
      role: 'assistant',
      content: '(called ask_which)',
      toolInvocations: [{ toolCallId: 'call_q', toolName: 'ask_which', result }],
    },
    { id: 'a2', role: 'assistant', content: REPLY },
  ];
}

describe('findPendingQuestion — the card shows', () => {
  it('on the streamed shape, drawn on the message that carries the reply', () => {
    const question = findPendingQuestion(streamed(), 'ready');
    expect(question?.toolCallId).toBe('call_q');
    expect(question?.messageId).toBe('a1');
    expect(question?.envelope.questions[0]?.options.map((o) => o.label)).toEqual([
      'Booked revenue',
      'Invoiced revenue',
    ]);
  });

  it('on the reloaded shape, drawn on the text message, not the tool message', () => {
    const question = findPendingQuestion(reloaded(), 'ready');
    expect(question?.toolCallId).toBe('call_q');
    expect(question?.messageId).toBe('a2');
  });

  it('for the new envelope as well as the legacy ask_which result', () => {
    const question = findPendingQuestion(streamed(ENVELOPE_RESULT), 'ready');
    expect(question?.envelope.preface).toBe('Revenue can be counted two ways.');
    expect(question?.envelope.questions[0]?.options[0]?.recommended).toBe(true);
  });

  it('when the reply matches the text up to surrounding whitespace', () => {
    expect(findPendingQuestion(streamed(LEGACY_RESULT, `${REPLY}\n`), 'ready')).not.toBeNull();
  });

  it('after an error status: the stream has ended', () => {
    expect(findPendingQuestion(streamed(), 'error')).not.toBeNull();
  });
});

describe('findPendingQuestion — the card stays away', () => {
  it('while the stream runs, or while a message still streams', () => {
    expect(findPendingQuestion(streamed(), 'streaming')).toBeNull();
    expect(findPendingQuestion(streamed(), 'submitted')).toBeNull();
    const messages = streamed();
    messages[1] = { ...messages[1], streaming: true };
    expect(findPendingQuestion(messages, 'ready')).toBeNull();
  });

  it('when the turn ended on other text than the question', () => {
    expect(findPendingQuestion(streamed(LEGACY_RESULT, 'Here is your revenue.'), 'ready')).toBeNull();
  });

  it('when another message ended the turn after the question', () => {
    const messages = [...reloaded(), { id: 'a3', role: 'assistant' as const, content: 'Something else.' }];
    expect(findPendingQuestion(messages, 'ready')).toBeNull();
  });

  it('when two questions came in one batch', () => {
    const messages = streamed();
    messages[1] = {
      ...messages[1],
      toolInvocations: [
        ...(messages[1].toolInvocations ?? []),
        { toolCallId: 'call_q2', toolName: 'ask_which', state: 'output-available', result: LEGACY_RESULT },
      ],
    };
    expect(findPendingQuestion(messages, 'ready')).toBeNull();
  });

  it('when a user message follows it — a HITL continuation counts as moving on', () => {
    expect(findPendingQuestion([...streamed(), { id: 'u2', role: 'user', content: 'Booked revenue' }], 'ready'))
      .toBeNull();
    expect(findPendingQuestion([...streamed(), { id: 'u2', role: 'user', content: '[HITL pa_1] approved' }], 'ready'))
      .toBeNull();
  });

  it('when a typed message is queued: it is sent, and sending something else is a skip', () => {
    expect(findPendingQuestion(streamed(), 'ready', { queued: true })).toBeNull();
  });

  it('while a write approval waits in the same segment; it comes back once decided', () => {
    const messages = streamed();
    messages[1] = {
      ...messages[1],
      toolInvocations: [
        { toolCallId: 'call_w', toolName: 'update_record', state: 'approval-requested', pendingActionId: 'pa_1' },
        ...(messages[1].toolInvocations ?? []),
      ],
    };
    expect(findPendingQuestion(messages, 'ready')).toBeNull();
    expect(findPendingQuestion(messages, 'ready', { toolDecisions: { call_w: { state: 'pending' } } })).toBeNull();
    expect(findPendingQuestion(messages, 'ready', { toolDecisions: { call_w: { state: 'success' } } }))
      .not.toBeNull();
  });

  it('when the user skipped it on this device', () => {
    expect(findPendingQuestion(streamed(), 'ready', { skipped: new Set(['call_q']) })).toBeNull();
    expect(findPendingQuestion(streamed(), 'ready', { skipped: new Set(['call_other']) })).not.toBeNull();
  });

  it('on a read-only transcript', () => {
    expect(findPendingQuestion(streamed(), 'ready', { readOnly: true })).toBeNull();
  });

  it('when the result is not a question envelope, or the tool failed', () => {
    expect(findPendingQuestion(streamed({ ...LEGACY_RESULT, readings: ['Only one'] }), 'ready')).toBeNull();
    const failed = streamed();
    failed[1] = {
      ...failed[1],
      toolInvocations: [{ toolCallId: 'call_q', toolName: 'ask_which', state: 'output-error', errorText: 'boom' }],
    };
    expect(findPendingQuestion(failed, 'ready')).toBeNull();
  });
});

describe('findQuestions — every question the conversation holds', () => {
  it('finds answered questions in history too, one per segment, by the message that draws them', () => {
    const messages: ChatbotEnhancedMessage[] = [
      ...reloaded(),
      { id: 'u2', role: 'user', content: 'Booked revenue' },
      { id: 'a3', role: 'assistant', content: 'Booked revenue this quarter is 1.2M.' },
    ];
    expect(findQuestions(messages).map((q) => [q.toolCallId, q.messageId])).toEqual([['call_q', 'a2']]);
    expect(findPendingQuestion(messages, 'ready')).toBeNull();
  });

  it('finds nothing where the reply does not match', () => {
    expect(findQuestions(streamed(LEGACY_RESULT, 'Something else.'))).toEqual([]);
  });
});
