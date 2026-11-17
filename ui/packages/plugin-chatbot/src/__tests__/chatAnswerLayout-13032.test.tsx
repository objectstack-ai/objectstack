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
import { Reasoning, ReasoningContent } from '../elements/reasoning';
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

/**
 * objectstack#33723 — `**` beside CJK full-width punctuation. CommonMark's
 * flanking rule reads full-width punctuation as punctuation, so a run with a
 * CJK letter on one side and full-width punctuation on the other never opens
 * or closes, and the asterisks show. Every chat markdown surface renders with
 * `CHAT_MARKDOWN_PLUGINS` (remark-cjk-friendly in streamdown's `cjk` slot).
 */
describe('bold next to CJK full-width punctuation (objectstack#33723)', () => {
  /** The text of every strong run in the rendered answer. */
  async function strongRuns(markdown: string): Promise<string[]> {
    const { container } = render(<MessageResponse>{markdown}</MessageResponse>);
    await waitFor(() => expect(container.querySelector('p, pre')).not.toBeNull());
    return Array.from(container.querySelectorAll('[data-streamdown="strong"]')).map((el) => el.textContent ?? '');
  }

  it.each([
    ['an opener after a CJK letter, before a book-title mark', '借书人是**《书名》**的作者', '《书名》'],
    ['an opener after a CJK letter, before a corner bracket', '他说**「引文」**之后', '「引文」'],
    ['a closer after a full-width comma, before a CJK letter', '他说**你好，**我们走', '你好，'],
    ['a closer after a full-width full stop, before a CJK letter', '看**这个。**然后', '这个。'],
    ['a closer after a full-width exclamation mark, before a CJK letter', '真**好！**再来', '好！'],
    ['a closer after a full-width question mark, before a CJK letter', '是**谁？**不知道', '谁？'],
    ['a closer after an enumeration comma, before a CJK letter', '有**甲、**乙两种', '甲、'],
    ['a closer after a closing corner bracket, before a CJK letter', '他说**「好」**然后走', '「好」'],
  ])('renders %s bold', async (_name, markdown, bold) => {
    expect(await strongRuns(markdown)).toEqual([bold]);
  });

  it.each([
    ['the card example, opener after a corner bracket', '「**《书名》，借书人**」', '《书名》，借书人'],
    ['bold ending before a full-width comma', '**借书人**，下一位', '借书人'],
    ['bold ending before a full-width full stop', '是**借书人**。', '借书人'],
    ['bold ending before a full-width exclamation mark', '是**借书人**！', '借书人'],
    ['bold ending before a full-width question mark', '是**借书人**？', '借书人'],
    ['bold ending before an enumeration comma', '**甲**、乙', '甲'],
    ['bold ending before a closing corner bracket', '「**开头**」再', '开头'],
    ['bold starting after an opening corner bracket', '说「**开头**」', '开头'],
  ])('control: %s stays bold', async (_name, markdown, bold) => {
    expect(await strongRuns(markdown)).toEqual([bold]);
  });

  it.each([
    ['ASCII emphasis', 'This is **bold** text and foo**bar**baz', ['bold', 'bar'], 'This is bold text and foobarbaz'],
    ['ASCII punctuation inside the run beside letters (CommonMark: literal)', 'a**"b"**c', [], 'a**"b"**c'],
    ['escaped asterisks', '\\*\\*《书名》\\*\\*', [], '**《书名》**'],
  ])('control: %s keeps its CommonMark meaning', async (_name, markdown, bold, text) => {
    const { container } = render(<MessageResponse>{markdown}</MessageResponse>);
    await waitFor(() => expect(container.querySelector('p')).not.toBeNull());
    const runs = Array.from(container.querySelectorAll('[data-streamdown="strong"]')).map((el) => el.textContent);
    expect(runs).toEqual(bold);
    expect(container.querySelector('p')!.textContent).toBe(text);
  });

  it('control: `**` inside an inline code span stays literal', async () => {
    const { container } = render(<MessageResponse>{'书名是`**《书名》**`的写法'}</MessageResponse>);
    await waitFor(() => expect(container.querySelector('code')).not.toBeNull());
    expect(container.querySelector('code')!.textContent).toBe('**《书名》**');
    expect(container.querySelector('[data-streamdown="strong"]')).toBeNull();
  });

  it('a caller\'s own plugins keep the CJK rule', async () => {
    const { container } = render(<MessageResponse plugins={{}}>{'借书人是**《书名》**的作者'}</MessageResponse>);
    await waitFor(() => expect(container.querySelector('p')).not.toBeNull());
    expect(container.querySelector('[data-streamdown="strong"]')?.textContent).toBe('《书名》');
  });

  it('the reasoning panel renders with the same rule', async () => {
    const { container } = render(
      <Reasoning defaultOpen>
        <ReasoningContent>{'借书人是**《书名》**的作者'}</ReasoningContent>
      </Reasoning>,
    );
    await waitFor(() => expect(container.querySelector('p')).not.toBeNull());
    expect(container.querySelector('[data-streamdown="strong"]')?.textContent).toBe('《书名》');
  });
});

/**
 * objectstack#34609 — the plain surface in the console's ~420px assistant dock.
 * Its gutter followed the VIEWPORT (`sm:px-0`), so on a desktop window the
 * message list and the composer lost their side padding inside the dock.
 *
 * happy-dom evaluates no container query, so this suite pins the class
 * contract: the plain root is an `@container`, the list and the composer share
 * one container-keyed gutter, an assistant turn spans the narrow column, and a
 * table draws inside its own horizontal scroll box.
 */
describe('the docked plain surface keeps one 16px gutter (objectstack#34609)', () => {
  const FOUR_COLUMN_TABLE = [
    'Open deals this quarter:',
    '',
    '| Account | Owner | Amount | Close date |',
    '|:--|:--|:--|:--|',
    '| Acme Corporation International | Jane Doe | $120,000.00 | 2026-12-31 |',
    '| Globex Industrial Holdings | John Smith | $98,500.00 | 2026-12-15 |',
  ].join('\n');

  async function renderChat(surface: 'plain' | 'card') {
    const messages = [
      { id: 'u1', role: 'user', content: 'show me open deals' },
      { id: 'a1', role: 'assistant', content: FOUR_COLUMN_TABLE },
    ] as ChatbotEnhancedMessage[];
    const view = render(
      <ChatbotEnhanced surface={surface} placeholder="Ask…" onSendMessage={vi.fn()} messages={messages} />,
    );
    await waitFor(() => expect(view.container.querySelector('[data-streamdown="table"]')).not.toBeNull());
    const { container } = view;
    const assistant = container.querySelector('.is-assistant')!;
    return {
      root: container.firstElementChild!,
      assistant,
      user: container.querySelector('.is-user')!,
      list: assistant.closest('.space-y-4')!,
      /** The composer's own width box on the plain surface (null on the card surface). */
      composer: container.querySelector('textarea')!.closest('.max-w-2xl'),
    };
  }

  /** A viewport-breakpoint padding utility — the class of defect this card fixed. */
  const VIEWPORT_GUTTER = /(^|\s)(sm|md|lg|xl|2xl):p[xlr]?-/;

  it('keys the gutter of the message list and the composer to the chat\'s own width', async () => {
    const { root, list, composer } = await renderChat('plain');
    expect(root).toHaveClass('@container');
    expect(composer).not.toBeNull();
    for (const el of [list, composer!]) {
      expect(el).toHaveClass('mx-auto', 'max-w-2xl', 'px-4', '@3xl:px-0');
      expect(el.className).not.toMatch(VIEWPORT_GUTTER);
    }
  });

  it('lets an assistant turn span the narrow column so it ends on the same gutter; the user bubble keeps its cap', async () => {
    const { assistant, user } = await renderChat('plain');
    expect(assistant).toHaveClass('max-w-full', '@3xl:max-w-[95%]');
    expect(assistant).not.toHaveClass('max-w-[95%]');
    expect(user).toHaveClass('max-w-[95%]');
  });

  it('draws a four-column table inside its own horizontal scroll box, within the answer', async () => {
    const { assistant } = await renderChat('plain');
    const table = assistant.querySelector('[data-streamdown="table"]')!;
    expect(table.querySelectorAll('th')).toHaveLength(4);
    const box = table.parentElement!;
    expect(box).toHaveClass('overflow-x-auto');
    expect(box.closest('[data-streamdown="table-wrapper"]')).not.toBeNull();
  });

  it('control: the card surface keeps its own chrome and bubble width', async () => {
    const { root, list, assistant } = await renderChat('card');
    expect(root).not.toHaveClass('@container');
    expect(list).toHaveClass('px-4', 'py-3');
    expect(list).not.toHaveClass('@3xl:px-0');
    expect(assistant).toHaveClass('max-w-[95%]');
  });
});
