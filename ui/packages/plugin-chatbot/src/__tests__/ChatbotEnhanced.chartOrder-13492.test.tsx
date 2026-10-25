/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13492 — an assistant answer renders its text and charts in the
 * order the stream produced them.
 *
 * Measured on the card: in the console's assistant panel (627px viewport) the
 * only chart of 「帮我分析一下客户」 started 785px down, under six paragraphs,
 * although the model drew it first — the bubble rendered `content`, then every
 * chart. The mapper's half (each chart's `textOffset`) is pinned in
 * `mapMessages.chartOrder-13492.test.ts`; this file feeds the bubble messages
 * mapped from real part sequences and reads the DOM order.
 *
 * happy-dom lays nothing out, so "first screen" is read as document order, and
 * the fold (objectui#13032) is driven through a stubbed `scrollHeight`, the way
 * `chatAnswerLayout-13032.test.tsx` drives it.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import type { ChatbotEnhancedMessage } from '../ChatbotEnhanced';
import { uiMessageToChatMessage } from '../mapMessages';

const user = { id: 'u1', role: 'user', content: 'analyse my customers' } as ChatbotEnhancedMessage;

const chartPart = (id: string, title: string) => ({
  type: 'data-chart',
  id,
  data: {
    type: 'chart',
    chartType: 'pie',
    title,
    xAxisKey: 'segment',
    series: [{ dataKey: 'count' }],
    data: [{ segment: 'healthy', count: 12 }],
  },
});
const text = (t: string) => ({ type: 'text', text: t });

function answer(parts: Array<Record<string, unknown>>, streaming = false): ChatbotEnhancedMessage {
  return { ...uiMessageToChatMessage({ id: 'a1', role: 'assistant', parts }), streaming };
}

function renderChat(message: ChatbotEnhancedMessage, extra: Partial<React.ComponentProps<typeof ChatbotEnhanced>> = {}) {
  return render(<ChatbotEnhanced placeholder="Ask…" onSendMessage={vi.fn()} messages={[user, message]} {...extra} />);
}

/** True when `a` comes before `b` in document order. */
function precedes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

const answers = (root: ParentNode) => Array.from(root.querySelectorAll('[data-chat-answer]'));
const charts = (root: ParentNode) => Array.from(root.querySelectorAll('[data-testid="chat-chart"]'));
/** The streaming caret the bubble draws after the text. */
const carets = (root: ParentNode) =>
  Array.from(root.querySelectorAll('span[aria-hidden]')).filter((el) => el.className.includes('w-[2px]'));

const restore: Array<() => void> = [];
afterEach(() => {
  while (restore.length) restore.pop()!();
});

describe('assistant text and charts render in stream order (objectui#13492)', () => {
  it('data-chart then text: the chart renders before the analysis', async () => {
    const { container } = renderChat(answer([chartPart('c0', 'Customer health'), text('Most customers are healthy.')]));
    await screen.findByText('Most customers are healthy.');
    const [chart] = charts(container);
    const [prose] = answers(container);
    expect(chart).toHaveTextContent('Customer health');
    expect(precedes(chart, prose)).toBe(true);
  });

  it('text, data-chart, text: the three render in that order', async () => {
    const { container } = renderChat(
      answer([text('Here is the breakdown.'), chartPart('c0', 'Customer health'), text('Three accounts need attention.')]),
    );
    await screen.findByText('Three accounts need attention.');
    const [before, after] = answers(container);
    const [chart] = charts(container);
    expect(answers(container)).toHaveLength(2);
    expect(before).toHaveTextContent('Here is the breakdown.');
    expect(after).toHaveTextContent('Three accounts need attention.');
    expect(precedes(before, chart)).toBe(true);
    expect(precedes(chart, after)).toBe(true);
  });

  it('CONTROL: a host-built message with no textOffset keeps the old layout, text then charts', async () => {
    const message = {
      id: 'a1',
      role: 'assistant',
      content: 'Here is the breakdown.',
      charts: [{ chartType: 'bar', title: 'Customer health', data: [], series: [{ dataKey: 'count' }] }],
    } as ChatbotEnhancedMessage;
    const { container } = renderChat(message);
    await screen.findByText('Here is the breakdown.');
    expect(answers(container)).toHaveLength(1);
    expect(precedes(answers(container)[0], charts(container)[0])).toBe(true);
  });

  it('a chart drawn before the first word keeps its mounted node when the text arrives', async () => {
    const { container, rerender } = renderChat(answer([chartPart('c0', 'Customer health')], true));
    const drawn = charts(container)[0];
    expect(drawn).toBeTruthy();
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={vi.fn()}
        messages={[user, answer([chartPart('c0', 'Customer health'), text('Most customers are healthy.')], true)]}
      />,
    );
    await screen.findByText('Most customers are healthy.');
    expect(charts(container)[0]).toBe(drawn);
  });

  it('the streaming caret rides the last text run, not the chart', async () => {
    const { container } = renderChat(
      answer([text('Here is the breakdown.'), chartPart('c0', 'Customer health'), text('Three accounts')], true),
    );
    await screen.findByText('Three accounts');
    const [caret] = carets(container);
    expect(carets(container)).toHaveLength(1);
    expect(precedes(answers(container)[1], caret)).toBe(true);
    expect(precedes(charts(container)[0], caret)).toBe(true);
  });

  it('objectui#13037 does not regress: a record link in the text after a chart opens through the host opener', async () => {
    const onOpenRecord = vi.fn();
    renderChat(
      answer([chartPart('c0', 'Customer health'), text('Top customer: [Wayne Enterprises](/record/account/acc_42).')]),
      { onOpenRecord },
    );
    const link = await screen.findByRole('button', { name: 'Wayne Enterprises' });
    await act(async () => {
      fireEvent.click(link);
    });
    await act(async () => {});
    expect(onOpenRecord).toHaveBeenCalledWith({ objectName: 'account', recordId: 'acc_42' });
  });

  it('objectui#13032 does not regress: the long analysis after a chart still folds once the stream ends', async () => {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
      ?? Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        // Only the long analysis is tall; the intro above the chart is not.
        return this.hasAttribute('data-chat-answer-body') && this.textContent?.includes('Long analysis') ? 5966 : 0;
      },
    });
    restore.push(() => {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', original);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    });
    const parts = [text('Intro.'), chartPart('c0', 'Customer health'), text('Long analysis of every segment.')];
    const { container, rerender } = renderChat(answer(parts, true));
    await screen.findByText('Long analysis of every segment.');
    await act(async () => {});
    expect(answers(container).some((el) => el.hasAttribute('data-folded'))).toBe(false);

    rerender(<ChatbotEnhanced placeholder="Ask…" onSendMessage={vi.fn()} messages={[user, answer(parts, false)]} />);
    await waitFor(() => expect(answers(container)[1]).toHaveAttribute('data-folded', 'true'));
    expect(answers(container)[0]).not.toHaveAttribute('data-folded');
    // The chart above the fold stays outside it.
    expect(answers(container)[1].contains(charts(container)[0])).toBe(false);
  });
});
