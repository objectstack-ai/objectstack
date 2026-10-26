/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13032 — an assistant answer read in the console's narrow assistant
 * panel (measured on the card: 419px wide, 794px tall, one answer 5,966px
 * tall, h2/h3 at 24/20px, a six-column table 1,177px wide in a 583px box, and
 * the scroll-to-bottom button lying over the text).
 *
 * happy-dom applies no Tailwind stylesheet and lays nothing out, so this suite
 * pins the CLASS contract (the font-size utility each heading carries, the
 * sticky first column) and feeds the geometry the component measures through
 * `scrollWidth` / `clientWidth` / `scrollHeight` / `clientHeight` getters.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessageResponse } from '../elements/message';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '../elements/conversation';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import type { ChatbotEnhancedMessage } from '../ChatbotEnhanced';

/** Geometry the component reads, set per test. */
const geometry = {
  /** `scrollHeight` of the answer body (`[data-chat-answer-body]`). */
  answerHeight: 0,
  /** `clientHeight` of the conversation's scroll viewport. */
  viewportHeight: 794,
  /** `scrollWidth` of a table's scroll box. */
  tableWidth: 0,
  /** `clientWidth` of a table's scroll box. */
  tableBoxWidth: 583,
};

const isTableBox = (el: Element) =>
  el.firstElementChild?.getAttribute('data-streamdown') === 'table';
const isViewport = (el: HTMLElement) =>
  el.dataset.testid === 'viewport' || el.style.overflow === 'auto';

const restore: Array<() => void> = [];
function stubGetter(name: 'scrollHeight' | 'clientHeight' | 'scrollWidth' | 'clientWidth', get: (el: HTMLElement) => number) {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, name)
    ?? Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
  Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    get(this: HTMLElement) {
      return get(this);
    },
  });
  restore.push(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  });
}

function stubGeometry() {
  stubGetter('scrollHeight', (el) => (el.hasAttribute('data-chat-answer-body') ? geometry.answerHeight : 0));
  stubGetter('clientHeight', (el) => (isViewport(el) ? geometry.viewportHeight : 0));
  stubGetter('scrollWidth', (el) => (isTableBox(el) ? geometry.tableWidth : 0));
  stubGetter('clientWidth', (el) => (isTableBox(el) ? geometry.tableBoxWidth : 0));
}

afterEach(() => {
  while (restore.length) restore.pop()!();
  geometry.answerHeight = 0;
  geometry.tableWidth = 0;
});

/** The px a Tailwind font-size utility on the element resolves to, or null. */
function fontSizePx(el: Element): number | null {
  const scale: Record<string, number> = {
    'text-xs': 12, 'text-sm': 14, 'text-base': 16, 'text-lg': 18,
    'text-xl': 20, 'text-2xl': 24, 'text-3xl': 30, 'text-4xl': 36,
  };
  let px: number | null = null;
  for (const cls of el.className.split(/\s+/)) {
    if (cls in scale) px = scale[cls];
    const arbitrary = /^text-\[(\d+(?:\.\d+)?)px\]$/.exec(cls);
    if (arbitrary) px = Number(arbitrary[1]);
  }
  return px;
}

const WIDE_TABLE = [
  '| Account | Industry | Owner | Stage | Amount | Close date |',
  '|:--|:--|:--|:--|:--|:--|',
  '| Acme Corporation | Manufacturing | Ada | Proposal | 120,000 | 2026-11-30 |',
  '| Globex | Energy | Lin | Negotiation | 98,000 | 2026-12-15 |',
].join('\n');

function inViewport(node: React.ReactNode) {
  return (
    <div data-testid="viewport" style={{ overflowY: 'auto' }}>
      {node}
    </div>
  );
}

describe('an assistant answer in the side panel (objectui#13032)', () => {
  it('(a) renders h1–h3 at chat size: 16px or less, hierarchy by weight', async () => {
    render(<MessageResponse>{'# Title\n\n## Summary\n\n### Top accounts\n\nBody text.'}</MessageResponse>);
    const h1 = await screen.findByRole('heading', { level: 1 });
    const h2 = screen.getByRole('heading', { level: 2 });
    const h3 = screen.getByRole('heading', { level: 3 });
    for (const heading of [h1, h2, h3]) {
      const px = fontSizePx(heading);
      expect(px).not.toBeNull();
      expect(px!).toBeGreaterThanOrEqual(15);
      expect(px!).toBeLessThanOrEqual(16);
    }
    expect(h2).toHaveClass('font-bold');
    expect(h3).toHaveClass('font-semibold');
  });

  it('(b) freezes a wide table\'s first column at 13px and shows the expand control when it overflows', async () => {
    stubGeometry();
    geometry.tableWidth = 1177;
    const { container } = render(<MessageResponse>{WIDE_TABLE}</MessageResponse>);
    const firstHeader = await screen.findByRole('columnheader', { name: 'Account' });
    const firstCell = screen.getByRole('cell', { name: 'Acme Corporation' });
    for (const cell of [firstHeader, firstCell]) {
      expect(cell).toHaveClass('first:sticky', 'first:left-0');
      expect(fontSizePx(cell)).toBe(13);
      expect(cell.parentElement!.firstElementChild).toBe(cell);
    }
    expect(fontSizePx(screen.getByRole('cell', { name: 'Manufacturing' }))).toBe(13);

    const expand = await waitFor(() => {
      const button = container.querySelector('[data-chat-table-expand]');
      expect(button).not.toBeNull();
      return button as HTMLButtonElement;
    });
    expect(expand).toHaveAttribute('title', 'Expand');
    expect(expand).toHaveAttribute('data-chat-table-expand', 'overflow');
    // The labelled pill the overflow state turns that button into.
    const answer = container.querySelector('[data-chat-answer]')!;
    expect(answer).toHaveClass(
      '[&_[data-chat-table-expand=overflow]]:after:content-[attr(title)]',
      '[&_[data-chat-table-expand=overflow]]:border',
    );
  });

  it('(b) control: a table that fits leaves the expand control unmarked', async () => {
    stubGeometry();
    geometry.tableWidth = 400;
    const { container } = render(<MessageResponse>{WIDE_TABLE}</MessageResponse>);
    await screen.findByRole('cell', { name: 'Acme Corporation' });
    await waitFor(() =>
      expect(container.querySelector('[data-chat-table-expand]')).toHaveAttribute('data-chat-table-expand', 'fit'),
    );
  });

  it('(c) folds a long answer once it stops streaming — never while streaming — and unfolds on demand', async () => {
    stubGeometry();
    geometry.answerHeight = 5966;
    const text = 'A long answer.\n\n'.repeat(40);
    const { container, rerender } = render(
      inViewport(<MessageResponse isAnimating>{text}</MessageResponse>),
    );
    await screen.findAllByText('A long answer.');
    const answer = () => container.querySelector('[data-chat-answer]')!;
    const body = () => container.querySelector('[data-chat-answer-body]')!;
    expect(answer()).not.toHaveAttribute('data-folded');
    expect(screen.queryByRole('button', { name: 'Show full answer' })).toBeNull();

    rerender(inViewport(<MessageResponse isAnimating={false}>{text}</MessageResponse>));
    await waitFor(() => expect(answer()).toHaveAttribute('data-folded', 'true'));
    expect(body()).toHaveClass('max-h-[28rem]', 'overflow-hidden');
    const show = screen.getByRole('button', { name: 'Show full answer' });
    expect(show).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(show);
    expect(answer()).not.toHaveAttribute('data-folded');
    expect(body()).not.toHaveClass('max-h-[28rem]');
    const collapse = screen.getByRole('button', { name: 'Collapse' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(collapse);
    expect(answer()).toHaveAttribute('data-folded', 'true');
  });

  it('(c) control: a short answer is not folded', async () => {
    stubGeometry();
    // Just under two viewport heights (2 × 794).
    geometry.answerHeight = 1580;
    const { container } = render(inViewport(<MessageResponse>{'A short answer.'}</MessageResponse>));
    await screen.findByText('A short answer.');
    await act(async () => {});
    expect(container.querySelector('[data-chat-answer]')).not.toHaveAttribute('data-folded');
    expect(screen.queryByRole('button', { name: 'Show full answer' })).toBeNull();
  });

  it('(c) the chat passes its streaming flag: a long reply folds only after the stream ends', async () => {
    stubGeometry();
    geometry.answerHeight = 5966;
    const user = { id: 'u1', role: 'user', content: '## Not a heading\n\nhelp me analyse my accounts' } as ChatbotEnhancedMessage;
    const reply = (streaming: boolean) =>
      ({ id: 'a1', role: 'assistant', content: 'Here is the analysis.', streaming }) as ChatbotEnhancedMessage;
    const { container, rerender } = render(
      <ChatbotEnhanced placeholder="Ask…" onSendMessage={vi.fn()} messages={[user, reply(true)]} />,
    );
    await screen.findByText('Here is the analysis.');
    await act(async () => {});
    expect(container.querySelector('[data-chat-answer]')).not.toHaveAttribute('data-folded');

    rerender(<ChatbotEnhanced placeholder="Ask…" onSendMessage={vi.fn()} messages={[user, reply(false)]} />);
    await waitFor(() =>
      expect(container.querySelector('[data-chat-answer]')).toHaveAttribute('data-folded', 'true'),
    );
    // CONTROL: the user's own bubble is untouched — plain text, no markdown, no fold.
    expect(screen.getByText(/## Not a heading/)).toBeInTheDocument();
    expect(container.querySelectorAll('[data-chat-answer]')).toHaveLength(1);
  });

  it('(d) lays the scroll-to-bottom button out below the message list, never over it', () => {
    const scrollRef = React.createRef<HTMLElement>() as React.MutableRefObject<HTMLElement | null>;
    const contentRef = React.createRef<HTMLElement>() as React.MutableRefObject<HTMLElement | null>;
    const instance = {
      scrollRef,
      contentRef,
      scrollToBottom: vi.fn(),
      stopScroll: vi.fn(),
      isAtBottom: false,
      isNearBottom: false,
      escapedFromLock: true,
      state: {},
    } as unknown as React.ComponentProps<typeof Conversation>['instance'];
    const { container } = render(
      <Conversation instance={instance}>
        <ConversationContent>
          <p>Acme Corporation</p>
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>,
    );
    const button = screen.getByRole('button');
    const list = scrollRef.current!;
    expect(list).toBeTruthy();
    expect(list.contains(button)).toBe(false);
    expect(button).not.toHaveClass('absolute');
    const row = container.querySelector('[data-conversation-scroll-row]')!;
    expect(row).toContainElement(button);
    expect(row).toHaveClass('shrink-0');
    // The row follows the list inside a column, so the list ends where it begins.
    expect(list.nextElementSibling).toBe(row);
    expect(list.parentElement).toHaveClass('flex', 'flex-col');
    expect(list).toHaveClass('min-h-0', 'flex-1');
  });
});
