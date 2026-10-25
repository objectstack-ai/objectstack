// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9233 — a rehydrated approval has to arrive with BOTH halves.
 *
 * The server persists conversations in ModelMessage format: a tool CALL on the
 * assistant row, its RESULT on a separate `tool` row. Everything an operator
 * needs to act on a pending approval travels that split:
 *
 *   * the `pendingActionId` — `useHitlInChat` keys its index on it, and without
 *     an entry `decide()` short-circuits with "No pending-action id found";
 *   * the `state` — `ChatbotEnhanced`'s `isAwaitingApproval` renders the
 *     Approve / Reject card only on `approval-requested`.
 *
 * objectui#8442 landed the first half. The second was still being erased by
 * `mergeToolResultsInto`, which rewrote the state to `output-available` on
 * every merge — so the card never rendered and there was no button to press
 * even though the wiring behind it was live. This file pins the whole path end
 * to end: server rows in, a decidable approval out.
 *
 * It lives in a `.tsx` file on purpose. "Indexable by `useHitlInChat`" is
 * measured by RUNNING the hook and watching the id reach the request, not by
 * restating the hook's predicate as an assertion here — a restated predicate
 * passes even when the hook has changed underneath it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHitlInChat } from '@object-ui/plugin-chatbot';
import { hydratedMessagesToChatMessages } from '../AiChatPage';
import {
  aiMessageRowsToServerMessages,
  toUIMessages,
} from '../../../hooks/useChatConversation';

/** The authenticated `/conversations/:id` shape, reconstructed from flat rows. */
function hydrateServerRows() {
  return hydratedMessagesToChatMessages(
    toUIMessages(
      aiMessageRowsToServerMessages([
        { id: 'u1', role: 'user', content: 'delete the task' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'This needs your approval.',
          tool_calls: JSON.stringify([
            {
              type: 'tool-call',
              toolCallId: 'c1',
              toolName: 'action_delete_task',
              input: { id: 't1' },
            },
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
                value: JSON.stringify({
                  status: 'pending_approval',
                  pendingActionId: 'pa_44',
                  toolName: 'action_delete_task',
                }),
              },
            },
          ]),
        },
      ]),
    ),
  );
}

describe('a rehydrated ModelMessage approval is decidable end to end (objectui#9233)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hydrates to approval-requested AND reaches the server with the pending id', async () => {
    const messages = hydrateServerRows();
    const tool = messages[1]?.toolInvocations?.[0];

    // HALF ONE — the render gate. `ChatbotEnhanced` shows the Approve / Reject
    // card only while `state === 'approval-requested'`; any terminal state and
    // the operator sees a finished tool call with no affordance at all.
    expect(tool?.state).toBe('approval-requested');

    // HALF TWO — the decision. Drive the REAL hook over the REAL hydrated
    // messages: the id is never persisted as a part key, so the only way it can
    // be here is the shared `detectPendingApproval` parse.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ status: 'executed', result: { deleted: 1 } }),
    } as Response);

    const { result } = renderHook(() =>
      useHitlInChat({ messages, apiBase: 'http://localhost:3004/api/v1/ai' }),
    );
    await act(async () => {
      await result.current.decide('c1', true);
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://localhost:3004/api/v1/ai/pending-actions/pa_44/approve');
    expect((init as RequestInit).method).toBe('POST');
    // Not merely "no crash": an unindexed invocation never calls fetch at all —
    // it sets this exact message and returns. Pinned so a regression that
    // un-indexes the id cannot read as a pass.
    expect(result.current.decisions['c1']?.message).not.toContain(
      'No pending-action id found',
    );
    expect(result.current.decisions['c1']?.state).toBe('success');
  });
});
