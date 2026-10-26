/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useObjectChat` — the declared message type tells the truth about both modes
 * (objectui#4424).
 *
 * The behavioural half of the card. `chat-message-contract.test.ts` pins the
 * TYPE; this file pins the VALUES the type is a statement about, and the two
 * only mean something together: the defect was a declaration that disagreed
 * with the values flowing through it, so proving either one alone reproduces
 * exactly the blindness that shipped.
 *
 * Read the ASSERTIONS as type assertions too. Every `messages[0].buildProgress`
 * / `.toolInvocations?.[0]?.pendingActionId` below is written WITHOUT a cast —
 * under the old declaration (`messages: OuiChatMessage[]`, the authoring
 * contract) not one of them would compile, which is precisely why nothing was
 * reading these keys off the hook and why a field-by-field rebuild anywhere on
 * the path would have deleted them with the compiler's blessing.
 */

import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { useObjectChat, type UseObjectChatOptions } from '../useObjectChat';

const API = 'https://example.test/api/v1/ai/agents/build/chat';

/**
 * One assistant turn as the AI SDK holds it: text, a tool call whose result is
 * an ADR-0033 pending-approval envelope, the reconciled build-progress part and
 * an inline chart. Every runtime-only key the card names is reachable from it.
 */
const { AI_MESSAGES } = vi.hoisted(() => ({
  AI_MESSAGES: [
    {
      id: 'm-built',
      role: 'assistant',
      metadata: { conversationId: 'conv-1' },
      parts: [
        { type: 'text', text: 'Built your app.' },
        {
          type: 'tool-apply_blueprint',
          toolCallId: 'call_build_1',
          state: 'output-available',
          input: { appLabel: 'Loans' },
          output: { status: 'pending_approval', pendingActionId: 'pa_42' },
        },
        {
          type: 'data-build-progress',
          id: 'bp-1',
          data: {
            phase: 'done',
            appLabel: 'Loans',
            items: [{ type: 'app', name: 'loans' }],
            done: 1,
            total: 1,
          },
        },
        {
          type: 'data-chart',
          id: 'chart-1',
          data: {
            chartType: 'bar',
            title: 'Loans by status',
            data: [{ status: 'open', n: 2 }],
            xAxisKey: 'status',
            series: [{ dataKey: 'n' }],
          },
        },
      ],
    },
  ],
}));

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: AI_MESSAGES,
    status: 'ready',
    error: undefined,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn(),
  }),
}));

describe('API mode: the runtime-only keys are on the hook, not just under it', () => {
  it('exposes buildProgress, charts and metadata on the returned messages', () => {
    const { result } = renderHook(() => useObjectChat({ api: API, conversationId: 'c1' }));

    const [message] = result.current.messages;
    expect(message.content).toBe('Built your app.');
    // The build panel. Erased by the old `as OuiChatMessage[]`.
    expect(message.buildProgress).toMatchObject({ phase: 'done', appLabel: 'Loans', total: 1 });
    // Inline charts — same erasure.
    expect(message.charts).toHaveLength(1);
    expect(message.charts?.[0]).toMatchObject({ chartType: 'bar', title: 'Loans by status' });
    // `metadata` is the key the hook splices back in; the authoring contract
    // DID declare this one, so it is the control in this experiment.
    expect(message.metadata).toEqual({ conversationId: 'conv-1' });
  });

  it('exposes the HITL approval extension on the tool invocation', () => {
    const { result } = renderHook(() => useObjectChat({ api: API, conversationId: 'c1' }));

    const tool = result.current.messages[0]?.toolInvocations?.[0];
    expect(tool?.toolName).toBe('apply_blueprint');
    // The approve/reject card's entire wiring: without `pendingActionId` there
    // is no id to POST a decision for, and `useHitlInChat` indexes nothing.
    expect(tool?.pendingActionId).toBe('pa_42');
    expect(tool?.state).toBe('approval-requested');
  });

  it('hands onSend the SAME shape it hands `messages`', () => {
    // The survey's second half. `onSend(content, messages)` is fed from the
    // same array, so a declaration that was honest for one and not the other
    // would be a new drift rather than a fix.
    const onSend = vi.fn();
    const { result } = renderHook(() =>
      useObjectChat({ api: API, conversationId: 'c1', onSend }),
    );

    act(() => {
      result.current.sendMessage('and now a chart');
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    // Typed by the PUBLISHED option type, so this line reads the same
    // declaration a host would — including the element type under test.
    const [content, messages] = onSend.mock.calls[0] as Parameters<
      NonNullable<UseObjectChatOptions['onSend']>
    >;
    expect(content).toBe('and now a chart');
    // …the thread as it will be after this send: the built turn, then the new
    // user message. The built turn still carries its render-only keys.
    expect(messages).toHaveLength(2);
    expect(messages[0]?.buildProgress?.phase).toBe('done');
    expect(messages[0]?.toolInvocations?.[0]?.pendingActionId).toBe('pa_42');
    expect(messages[1]).toMatchObject({ role: 'user', content: 'and now a chart' });
  });
});

describe('local mode: the authoring-only values the runtime type would have lied about', () => {
  it("keeps an authored 'tool' role and absorbs an authored Date", () => {
    // This is the measurement that decided the shape of the honest type. If
    // local mode were also runtime-shaped, `ChatbotEnhanced`'s ChatMessage
    // would simply BE the truth; it is not, in two named ways — and both are
    // deliberate (`normalizeMessages` narrows neither role nor tool state; the
    // fold happens at the render seam).
    const { result } = renderHook(() =>
      useObjectChat({
        initialMessages: [
          {
            id: 'a1',
            role: 'tool',
            content: 'tool said x',
            timestamp: new Date('2026-08-12T02:08:13.000Z'),
            toolInvocations: [
              { toolCallId: 'call_legacy', toolName: 'lookup', state: 'result' },
            ],
          },
        ],
      }),
    );

    expect(result.current.isApiMode).toBe(false);
    const [message] = result.current.messages;
    // Wide where local mode is wide: the runtime contract has no 'tool' role
    // and no 'result' state, so declaring it here would have been a lie.
    expect(message.role).toBe('tool');
    expect(message.toolInvocations?.[0]?.state).toBe('result');
    // Narrow where BOTH modes are narrow: an authored `Date` never leaves this
    // hook, so `timestamp?: string` is the honest declaration.
    expect(message.timestamp).toBe('2026-08-12T02:08:13.000Z');
  });
});
