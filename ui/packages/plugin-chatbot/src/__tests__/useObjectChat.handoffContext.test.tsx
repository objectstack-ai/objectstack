/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0057 P4 / cloud#817 — INTEGRATION test for the ask→build handoff context
 * on the REAL `useObjectChat` transport (not just the pure `withHandoffContext`
 * merge). It captures the outgoing chat POST bodies and asserts that the handed-
 * off `ask` conversation id rides `context.parentConversationId` on the FIRST
 * turn only — the backend redeems it once, and the client owns history after
 * that, so re-sending would re-inject the same context block.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import { useObjectChat } from '../useObjectChat';

const API = 'https://example.test/api/v1/ai/agents/build/chat';

/** A minimal, well-formed Vercel AI UI-message data stream so a send completes
 *  cleanly and the hook is ready for the next turn. */
function dataStreamResponse(): Response {
  const body =
    'data: {"type":"start"}\n\n' +
    'data: {"type":"finish"}\n\n' +
    'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'x-vercel-ai-ui-message-stream': 'v1',
    },
  });
}

/** Parse the `context` object out of a captured fetch call's JSON body. */
function contextOf(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[callIndex]?.[1] as { body?: string } | undefined;
  const parsed = JSON.parse(init?.body ?? '{}') as { context?: Record<string, unknown> };
  return parsed.context ?? {};
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useObjectChat — ask→build handoff context (cloud#817)', () => {
  it('sends context.parentConversationId on the FIRST turn only', async () => {
    const fetchMock = vi.fn(async () => dataStreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useObjectChat({
        api: API,
        conversationId: 'build_1',
        parentConversationId: 'ask_42',
        body: { context: { agentName: 'build', packageId: 'app.crm' } },
      }),
    );

    // Turn 1 — the handoff turn.
    await act(async () => {
      result.current.sendMessage('add a priority field to tasks');
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const ctx1 = contextOf(fetchMock, 0);
    expect(ctx1.parentConversationId).toBe('ask_42');
    // The existing context (agentName/packageId) is preserved, not clobbered.
    expect(ctx1).toMatchObject({ agentName: 'build', packageId: 'app.crm' });

    // Turn 2 — a normal follow-up; the parent must NOT ride again.
    await act(async () => {
      result.current.sendMessage('also add a due date');
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const ctx2 = contextOf(fetchMock, 1);
    expect(ctx2.parentConversationId).toBeUndefined();
    expect(ctx2).toMatchObject({ agentName: 'build', packageId: 'app.crm' });
  });

  it('re-carries on a SECOND handoff (falsy→truthy transition re-arms, even same id)', async () => {
    // #2: a second "Open in Builder →" resumes the singleton build conversation
    // and re-supplies the SAME ask id. The URL-mirror strips the param between
    // handoffs (truthy→falsy→truthy), which is the fresh-arrival signal — a
    // value-equality check would miss it.
    const fetchMock = vi.fn(async () => dataStreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ parent }: { parent?: string }) =>
        useObjectChat({
          api: API,
          conversationId: 'build_1',
          parentConversationId: parent,
          body: { context: { agentName: 'build' } },
        }),
      { initialProps: { parent: 'ask_42' as string | undefined } },
    );

    // First handoff turn carries it, then it's consumed.
    await act(async () => { result.current.sendMessage('first handoff'); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(contextOf(fetchMock, 0).parentConversationId).toBe('ask_42');

    // URL-mirror strips the param (truthy→falsy).
    rerender({ parent: undefined });
    // Second handoff re-supplies the SAME id (falsy→truthy) → re-armed.
    rerender({ parent: 'ask_42' });

    await act(async () => { result.current.sendMessage('second handoff'); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(contextOf(fetchMock, 1).parentConversationId).toBe('ask_42');
  });

  it('sends no parentConversationId when none was handed off', async () => {
    const fetchMock = vi.fn(async () => dataStreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useObjectChat({
        api: API,
        conversationId: 'build_1',
        body: { context: { agentName: 'build' } },
      }),
    );

    await act(async () => {
      result.current.sendMessage('hello');
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(contextOf(fetchMock, 0).parentConversationId).toBeUndefined();
  });
});
