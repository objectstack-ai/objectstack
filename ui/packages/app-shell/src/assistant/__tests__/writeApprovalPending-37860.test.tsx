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

describe('a write awaiting approval, as the drawer host reads it (objectstack#37860)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
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
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ status: 'executed', result: { deleted: 1 } }),
    } as Response);
    const approved = renderHook(() => useHitlInChat({ messages, apiBase: '/api/v1/ai' }));
    await act(async () => {
      await approved.result.current.decide('c1', true);
    });
    expect(approved.result.current.decisions.c1?.state).toBe('success');
    expect(countWritesAwaitingApproval(messages, approved.result.current.decisions)).toBe(0);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' } as Response);
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
