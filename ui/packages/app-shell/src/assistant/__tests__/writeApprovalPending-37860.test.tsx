// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ui ADR-0057 Amendment A5, row 3 (objectstack#37860) — a conversation holds a
 * write awaiting the user's approval while a proposed write the framework
 * parked as a pending action has no decision in the chat, or one that failed.
 *
 * ## Real subjects
 *
 * The real hydration of stored server rows (the path a reopened conversation
 * takes) and the real `useHitlInChat` decisions, as `ChatPane` hands both to
 * `countWritesAwaitingApproval` before publishing the answer to the bus.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
// `ChatPane` reaches `import('@object-ui/plugin-grid')`; pay its first load at
// collection, never inside a clocked case (`check:test-source-alias`).
import '@object-ui/plugin-grid';
import { useHitlInChat } from '@object-ui/plugin-chatbot';
import { hydratedMessagesToChatMessages } from '../../console/ai/AiChatPage';
import { aiMessageRowsToServerMessages, toUIMessages } from '../../hooks/useChatConversation';
import { countWritesAwaitingApproval } from '../writeApprovalPending';

/** A stored conversation whose last tool call came back as a pending approval. */
function hydratePendingWrite() {
  return hydratedMessagesToChatMessages(
    toUIMessages(
      aiMessageRowsToServerMessages([
        { id: 'u1', role: 'user', content: 'delete the task' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'This needs your approval.',
          tool_calls: JSON.stringify([
            { type: 'tool-call', toolCallId: 'c1', toolName: 'action_delete_task', input: { id: 't1' } },
          ]),
        },
        {
          id: 't1',
          role: 'tool',
          tool_call_id: 'c1',
          content: JSON.stringify([
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'action_delete_task',
              output: {
                type: 'text',
                value: JSON.stringify({ status: 'pending_approval', pendingActionId: 'pa_1', toolName: 'action_delete_task' }),
              },
            },
          ]),
        },
      ]),
    ),
  );
}

/**
 * The decision POSTs this file scripts, answered in order. Since
 * objectstack#38250 the hook also reads each awaiting card's row once
 * (`GET …/pending-actions/:id`); that read is answered 404 here, which leaves
 * the card as it is, so the scripted replies reach the decision they were
 * written for.
 */
const decisionReplies: Response[] = [];
function decisionReply(reply: Response): void {
  decisionReplies.push(reply);
}
function stubDecisionFetch(): void {
  decisionReplies.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'GET'
        ? ({ ok: false, status: 404, text: async () => '' } as Response)
        : (decisionReplies.shift() as Response),
    ),
  );
}

describe('a write awaiting approval, as the drawer host reads it (objectstack#37860)', () => {
  beforeEach(() => {
    stubDecisionFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a reopened conversation with an undecided pending write counts it', () => {
    expect(countWritesAwaitingApproval(hydratePendingWrite(), {})).toBe(1);
  });

  it('an approval the user made in the chat clears it; a failed one leaves it waiting', async () => {
    const messages = hydratePendingWrite();
    decisionReply({
      ok: true,
      text: async () => JSON.stringify({ status: 'executed', result: { deleted: 1 } }),
    } as Response);
    const approved = renderHook(() => useHitlInChat({ messages, apiBase: '/api/v1/ai' }));
    await act(async () => {
      await approved.result.current.decide('c1', true);
    });
    expect(approved.result.current.decisions.c1?.state).toBe('success');
    expect(countWritesAwaitingApproval(messages, approved.result.current.decisions)).toBe(0);

    decisionReply({ ok: false, status: 500, text: async () => 'boom' } as Response);
    const failed = renderHook(() => useHitlInChat({ messages, apiBase: '/api/v1/ai' }));
    await act(async () => {
      await failed.result.current.decide('c1', true);
    });
    expect(failed.result.current.decisions.c1?.state).toBe('error');
    expect(countWritesAwaitingApproval(messages, failed.result.current.decisions)).toBe(1);
  });

  it('control: a conversation with no parked write has none', () => {
    const messages = hydratedMessagesToChatMessages(
      toUIMessages(
        aiMessageRowsToServerMessages([
          { id: 'u1', role: 'user', content: 'how many accounts?' },
          { id: 'a1', role: 'assistant', content: 'Twelve.' },
        ]),
      ),
    );
    expect(countWritesAwaitingApproval(messages, {})).toBe(0);
  });
});
