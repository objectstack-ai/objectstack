/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#30223 — after 确认 / 取消 on the chat's confirm card,
 * `useHitlInChat` sends the model a follow-up turn through the ordinary
 * user-message channel. The model must still receive that text; the person
 * must not see it as their own bubble.
 *
 * Driven end to end on the REAL hooks: `useHitlInChat` decides over a mocked
 * pending-actions endpoint, its continuation goes through `useObjectChat`'s
 * real transport (the captured chat POST is the model-facing payload), and the
 * hook's resulting messages are drawn by `ChatbotEnhanced` through the same
 * `toRuntimeMessages` seam the console page uses.
 */
import '@testing-library/jest-dom/vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';
import { toRuntimeMessages } from '../chatMessageAdapter';
import { hitlContinuationTag, isHitlContinuation } from '../hitlContinuation';
import { useHitlInChat } from '../useHitlInChat';
import { useObjectChat } from '../useObjectChat';

const CHAT_API = 'https://example.test/api/v1/ai/agents/data_chat/chat';
const AI_BASE = 'https://example.test/api/v1/ai';
const ASK = '把验收客户 R2 的状态改成 Active';

const proposal: ChatbotEnhancedMessage = {
  id: 'a-1',
  role: 'assistant',
  content: '',
  toolInvocations: [
    {
      toolCallId: 'tc-1',
      toolName: 'update_record',
      state: 'approval-requested',
      args: { objectName: 'jpph_customer', recordId: 'r2' },
      result: { status: 'pending_approval', pendingActionId: 'pa_8cf4' },
      pendingActionId: 'pa_8cf4',
    },
  ],
};

function chatStream(): Response {
  return new Response('data: {"type":"start"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The last user message's text in a captured chat POST — what the model reads. */
function lastUserTextSent(fetchMock: ReturnType<typeof vi.fn>): string {
  const chatCall = fetchMock.mock.calls.filter(([url]) => String(url) === CHAT_API).at(-1);
  const body = JSON.parse((chatCall?.[1] as { body?: string } | undefined)?.body ?? '{}') as {
    messages?: Array<{ role: string; parts?: Array<{ type: string; text?: string }> }>;
  };
  const user = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
  return (user?.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text ?? '').join('');
}

/** One chat page: the real chat hook, with the HITL bridge wired the way AiChatPage wires it. */
function mountChat(decisionResponse: unknown) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
    String(url).includes('/pending-actions/') ? json(decisionResponse) : chatStream(),
  );
  vi.stubGlobal('fetch', fetchMock);
  const hook = renderHook(() => {
    const chat = useObjectChat({
      api: CHAT_API,
      conversationId: 'conv-1',
      initialMessages: [{ id: 'u-1', role: 'user', content: ASK }],
    });
    const hitl = useHitlInChat({
      messages: [proposal],
      apiBase: AI_BASE,
      continueConversation: (prompt) => chat.sendMessage(prompt),
    });
    return { chat, hitl };
  });
  return { fetchMock, ...hook };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectstack#30223 — the HITL continuation is the model\'s, not the person\'s', () => {
  it('确认: the model receives the continuation, the transcript draws no bubble for it', async () => {
    const { fetchMock, result } = mountChat({
      status: 'executed',
      result: { status: 'written', operation: 'update', recordId: 'r2' },
    });

    await act(async () => {
      await result.current.hitl.decide('tc-1', true);
    });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u) === CHAT_API)).toBe(true));

    // The model-facing payload still carries the whole continuation, marker first.
    const sent = lastUserTextSent(fetchMock);
    expect(sent.startsWith(hitlContinuationTag('pa_8cf4'))).toBe(true);
    expect(sent).toContain('The operator approved the `update_record` call');
    expect(sent).toContain('"recordId":"r2"');
    expect(isHitlContinuation(sent)).toBe(true);

    // The chat hook holds it as a user message (that is the channel) …
    const messages = result.current.chat.messages;
    expect(messages.some((m) => m.role === 'user' && m.content === sent)).toBe(true);

    // … and the transcript does not draw it, while the person's own ask stays.
    render(<ChatbotEnhanced messages={toRuntimeMessages(messages)} />);
    expect(screen.getByText(ASK)).toBeInTheDocument();
    expect(screen.queryByText(/The operator approved/)).toBeNull();
    expect(screen.queryByText(/\[HITL pa_8cf4\]/)).toBeNull();
  });

  it('取消: the rejection continuation is sent and not drawn either', async () => {
    const { fetchMock, result } = mountChat({ status: 'rejected', id: 'pa_8cf4' });

    await act(async () => {
      await result.current.hitl.decide('tc-1', false, '已在卡片上取消');
    });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u) === CHAT_API)).toBe(true));

    const sent = lastUserTextSent(fetchMock);
    expect(sent).toContain('The operator rejected the `update_record` call');
    expect(isHitlContinuation(sent)).toBe(true);

    render(<ChatbotEnhanced messages={toRuntimeMessages(result.current.chat.messages)} />);
    expect(screen.getByText(ASK)).toBeInTheDocument();
    expect(screen.queryByText(/The operator rejected/)).toBeNull();
  });

  it('CONTROL: an ordinary user message is sent and drawn unchanged', async () => {
    const { fetchMock, result } = mountChat({ status: 'executed' });
    const typed = 'Now also set its owner to Li Lei';

    await act(async () => {
      result.current.chat.sendMessage(typed);
    });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u) === CHAT_API)).toBe(true));

    expect(lastUserTextSent(fetchMock)).toBe(typed);
    render(<ChatbotEnhanced messages={toRuntimeMessages(result.current.chat.messages)} />);
    expect(screen.getByText(ASK)).toBeInTheDocument();
    expect(screen.getByText(typed)).toBeInTheDocument();
  });
});

describe('isHitlContinuation — the one reader of the marker', () => {
  it('reads the tag the producer writes', () => {
    expect(isHitlContinuation(`${hitlContinuationTag('pa_2b60f90b-1c')} The operator approved …`)).toBe(true);
  });

  it('CONTROL: the person\'s own text, a tag that is not first, and non-strings are not continuations', () => {
    expect(isHitlContinuation('把这条状态改成 Active')).toBe(false);
    expect(isHitlContinuation('what does [HITL pa_1] mean?')).toBe(false);
    expect(isHitlContinuation('[HITL] approved')).toBe(false);
    expect(isHitlContinuation(undefined)).toBe(false);
    expect(isHitlContinuation({ text: '[HITL pa_1] x' })).toBe(false);
  });
});
