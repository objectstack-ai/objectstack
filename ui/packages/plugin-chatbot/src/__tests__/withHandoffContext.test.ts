/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit tests for ADR-0057 P4 / cloud#817 — the ask→build handoff carries the
 * source `ask` conversation id into the Builder's FIRST turn as
 * `context.parentConversationId`. `withHandoffContext` is the pure merge wired
 * into the chat transport's `prepareSendMessagesRequest`; the "first turn only"
 * clearing lives in the ref beside it (see useObjectChat).
 */
import { describe, it, expect } from 'vitest';
import { withHandoffContext } from '../useObjectChat';

describe('withHandoffContext', () => {
  it('nests parentConversationId under context (where the agent route reads it)', () => {
    const out = withHandoffContext(
      { conversationId: 'build_1', context: { agentName: 'build', packageId: 'app.crm' } },
      'ask_42',
    );
    expect(out.context).toMatchObject({
      agentName: 'build',
      packageId: 'app.crm',
      parentConversationId: 'ask_42',
    });
    // Sibling body fields are preserved.
    expect(out.conversationId).toBe('build_1');
  });

  it('creates context when the body has none', () => {
    const out = withHandoffContext({ conversationId: 'b1' }, 'ask_9');
    expect(out.context).toEqual({ parentConversationId: 'ask_9' });
  });

  it('does NOT mutate the input body or its context (cached transport body is shared)', () => {
    const ctx = { agentName: 'build' };
    const body = { context: ctx };
    const out = withHandoffContext(body, 'ask_7');
    expect(out).not.toBe(body);
    expect(out.context).not.toBe(ctx);
    // Original is untouched — a later turn re-using it must not carry the parent.
    expect(ctx).toEqual({ agentName: 'build' });
    expect('parentConversationId' in ctx).toBe(false);
  });
});
