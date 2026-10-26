/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13492 — a re-hydrated stored message keeps its chart order.
 *
 * In API mode a host restores a thread by handing `useObjectChat` its stored
 * messages; one that carries `parts` reaches the AI SDK store untouched, and
 * the hook maps the store back on every render. The mock below stands in for
 * the store: `useChat` answers with the very messages it was initialised
 * with, so what the bubble renders is the restored thread, read through the
 * same mapper the live stream goes through.
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

/** The stored turn: the model drew the chart, then wrote its analysis. */
const STORED: NonNullable<UseObjectChatOptions['initialMessages']> = [
  { id: 'u1', role: 'user', content: '帮我分析一下客户', parts: [{ type: 'text', text: '帮我分析一下客户' }] },
  {
    id: 'a1',
    role: 'assistant',
    content: '',
    parts: [
      {
        type: 'data-chart',
        id: 'chart-0',
        data: {
          chartType: 'pie',
          title: 'Customer health',
          xAxisKey: 'segment',
          series: [{ dataKey: 'count' }],
          data: [{ segment: 'healthy', count: 12 }],
        },
      },
      { type: 'text', text: 'Most customers are healthy.' },
    ],
  },
];

describe('a re-hydrated stored message keeps its chart order (objectui#13492)', () => {
  it('the restored chart keeps its offset', () => {
    const { result } = renderHook(() => useObjectChat({ api: API, conversationId: 'c1', initialMessages: STORED }));
    const restored = result.current.messages[1];
    expect(restored.content).toBe('Most customers are healthy.');
    expect(restored.charts?.map((c) => [c.title, c.textOffset])).toEqual([['Customer health', 0]]);
  });

  it('and the bubble renders the chart above the analysis', async () => {
    const { result } = renderHook(() => useObjectChat({ api: API, conversationId: 'c1', initialMessages: STORED }));
    const { container } = render(
      <ChatbotEnhanced placeholder="Ask…" onSendMessage={vi.fn()} messages={toRuntimeMessages(result.current.messages)} />,
    );
    await screen.findByText('Most customers are healthy.');
    const chart = container.querySelector('[data-testid="chat-chart"]')!;
    const prose = container.querySelector('[data-chat-answer]')!;
    expect(chart).toHaveTextContent('Customer health');
    expect(chart.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
