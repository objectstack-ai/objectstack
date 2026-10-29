/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25908 — a hydrated answer's chart survives API mode's store.
 *
 * app-shell hands `useObjectChat` the hydrated thread as messages with a joined
 * `content`, `charts` placed by `textOffset`, and the `visualize_data`
 * invocation that persisted the chart. API mode rebuilds each message into the
 * AI SDK store and maps the store back on every render, so the chart has to be
 * rebuilt as the `data-chart` part the live stream gave, at its offset. The
 * mock below stands in for the store, as in
 * `useObjectChat.chartOrderRehydrate-13492.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { toRuntimeMessages } from '../chatMessageAdapter';
import { useObjectChat, type UseObjectChatOptions } from '../useObjectChat';

vi.mock('@ai-sdk/react', () => ({
  useChat: (opts: { messages?: unknown[] }) => ({
    messages: opts.messages ?? [],
    status: 'ready',
    error: undefined,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn(),
  }),
}));

const API = 'https://example.test/api/v1/ai/agents/ask/chat';

const INTRO = 'Here is the pipeline.';
const AFTER = 'Most of it sits in the late stages.';

const CHART = {
  chartType: 'bar' as const,
  title: 'Pipeline by stage',
  data: [
    { stage: 'qualify', amount: 10 },
    { stage: 'close', amount: 40 },
  ],
  xAxisKey: 'stage',
  series: [{ dataKey: 'amount', label: 'Amount' }],
};

/** A hydrated answer: the chart between the two runs, and the result that persisted it. */
const HYDRATED: NonNullable<UseObjectChatOptions['initialMessages']> = [
  { id: 'u1', role: 'user', content: 'Show me the pipeline' },
  {
    id: 'a1',
    role: 'assistant',
    content: `${INTRO}${AFTER}`,
    charts: [{ ...CHART, textOffset: INTRO.length }],
    toolInvocations: [
      {
        toolCallId: 'call_1',
        toolName: 'visualize_data',
        state: 'output-available',
        result: { type: 'text', value: JSON.stringify({ rendered: 'chart', chart: { type: 'chart', ...CHART } }) },
      },
    ],
  },
];

describe('a hydrated chart survives the API-mode store (objectstack#25908)', () => {
  it('the restored answer keeps its one chart at its offset', () => {
    const { result } = renderHook(() => useObjectChat({ api: API, conversationId: 'c1', initialMessages: HYDRATED }));
    const restored = result.current.messages[1];
    expect(restored.content).toBe(`${INTRO}${AFTER}`);
    expect(restored.charts).toEqual([{ ...CHART, textOffset: INTRO.length }]);
  });

  it('and the bubble draws it once, between the text it sat between', async () => {
    const { result } = renderHook(() => useObjectChat({ api: API, conversationId: 'c1', initialMessages: HYDRATED }));
    const { container } = render(
      <ChatbotEnhanced placeholder="Ask…" onSendMessage={vi.fn()} messages={toRuntimeMessages(result.current.messages)} />,
    );
    await screen.findByText(AFTER);
    const charts = container.querySelectorAll('[data-testid="chat-chart"]');
    expect(charts).toHaveLength(1);
    expect(charts[0]).toHaveTextContent('Pipeline by stage');
    const [before, after] = Array.from(container.querySelectorAll('[data-chat-answer]'));
    expect(before).toHaveTextContent(INTRO);
    expect(after).toHaveTextContent(AFTER);
    expect(before.compareDocumentPosition(charts[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(charts[0].compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
