/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit tests for turn idempotency (ADR-0013 D1). `withTurnId` is wired into
 * the chat transport's `prepareSendMessagesRequest` so every outgoing turn
 * carries a stable `turnId` derived from the triggering user message — the
 * key the server uses to dedup the user message and short-circuit a completed
 * turn on Retry instead of re-planning.
 */
import { describe, it, expect } from 'vitest';
import { withTurnId } from '../useObjectChat';

describe('withTurnId', () => {
  it('derives turnId from the last user message id', () => {
    const out = withTurnId({
      body: { conversationId: 'conv_1' },
      messages: [
        { id: 'u1', role: 'user' },
        { id: 'a1', role: 'assistant' },
        { id: 'u2', role: 'user' },
      ],
    });
    expect(out.body.turnId).toBe('u2');
    // Existing body fields are preserved.
    expect(out.body.conversationId).toBe('conv_1');
  });

  it('reconstructs the default body fields (the hook output is sent VERBATIM)', () => {
    // Regression: returning a body WITHOUT messages makes the server 400 with
    // "messages array is required". The hook must re-include id/messages/
    // trigger/messageId, since the SDK does not merge its defaults back in.
    const messages = [{ id: 'u1', role: 'user' }];
    const out = withTurnId({
      id: 'chat_1',
      body: { conversationId: 'conv_1' },
      messages,
      trigger: 'submit-message',
      messageId: 'u1',
    });
    expect(out.body.messages).toBe(messages);
    expect(out.body.id).toBe('chat_1');
    expect(out.body.trigger).toBe('submit-message');
    expect(out.body.messageId).toBe('u1');
    expect(out.body.turnId).toBe('u1');
    expect(out.body.conversationId).toBe('conv_1');
  });

  it('is stable across a Retry — same triggering user message → same turnId', () => {
    // Initial submit: messages end with the new user turn.
    const submit = withTurnId({
      body: {},
      messages: [
        { id: 'u1', role: 'user' },
        { id: 'a1', role: 'assistant' },
        { id: 'u2', role: 'user' },
      ],
    });
    // Retry/regenerate re-sends the SAME trailing user turn (the assistant
    // reply being regenerated may be absent or re-appended after it).
    const retry = withTurnId({
      body: {},
      messages: [
        { id: 'u1', role: 'user' },
        { id: 'a1', role: 'assistant' },
        { id: 'u2', role: 'user' },
        { id: 'a2-failed', role: 'assistant' },
      ],
    });
    expect(submit.body.turnId).toBe('u2');
    expect(retry.body.turnId).toBe('u2');
  });

  it('produces a distinct turnId for each new user turn', () => {
    const first = withTurnId({ body: {}, messages: [{ id: 'u1', role: 'user' }] });
    const second = withTurnId({
      body: {},
      messages: [
        { id: 'u1', role: 'user' },
        { id: 'a1', role: 'assistant' },
        { id: 'u2', role: 'user' },
      ],
    });
    expect(first.body.turnId).toBe('u1');
    expect(second.body.turnId).toBe('u2');
    expect(first.body.turnId).not.toBe(second.body.turnId);
  });

  it('omits turnId when there is no user message (defensive)', () => {
    const out = withTurnId({ body: { keep: 1 }, messages: [{ id: 'a1', role: 'assistant' }] });
    expect(out.body.turnId).toBeUndefined();
    expect(out.body.keep).toBe(1);
  });
});
