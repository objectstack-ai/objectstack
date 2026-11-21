/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The phone's comment page (objectstack#36076), drawn from the host's
 * `DiscussionContext` alone:
 *
 * - The list shows the top-level comments, oldest first, each with its
 *   「N 条回复」; no reply is on the list. A tap on a comment (or on its reply
 *   count) opens its thread; a tap on a reaction is the reaction's.
 * - A thread shows its comment first and every reply after it.
 * - The comment box is docked at the foot: in the list it writes a comment, in
 *   a thread a reply to the thread's comment. It names no keyboard shortcut,
 *   and its toolbar sits under the text: mention, bold, italic, list, code,
 *   send.
 * - A long press (or the context menu) raises the comment's actions: the six
 *   reactions, Mark resolved on a thread's comment only, Edit and Delete only
 *   where the comment thread hands them (the viewer's own comment). The click
 *   that ends the hold opens nothing. The first hold tells the host.
 * - The filter (resolved shown, only mine) is the desktop panel's.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import { DiscussionContextProvider, type DiscussionContextValue } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { CommentsPage, type CommentsPageProps } from './CommentsPage';
import { COMMENT_LONG_PRESS_MS } from './useCommentPress';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const at = (minute: number) => new Date(Date.UTC(2026, 10, 21, 9, minute)).toISOString();

// c1: the viewer's, two replies, a 👍 of the viewer's. c2: Grace's.
const ITEMS: FeedItem[] = [
  { id: 'c2', type: 'comment', actor: 'Grace', body: 'second thread', createdAt: at(10), resolved: false },
  {
    id: 'c1',
    type: 'comment',
    actor: 'Ada',
    body: 'first thread',
    createdAt: at(1),
    authoredByViewer: true,
    resolved: false,
    reactions: [{ emoji: '👍', count: 1, reacted: true }],
  },
  { id: 'r1', type: 'comment', actor: 'Grace', body: 'first reply', createdAt: at(5), parentId: 'c1' },
  { id: 'r2', type: 'comment', actor: 'Ada', body: 'second reply', createdAt: at(6), parentId: 'c1', authoredByViewer: true },
  { id: 'a1', type: 'field_change', actor: 'System', body: 'stage changed', createdAt: at(2) },
];

function renderPage(
  props: Partial<CommentsPageProps> = {},
  value: Partial<DiscussionContextValue> = {},
) {
  const writes = {
    onAddComment: vi.fn(),
    onAddReply: vi.fn(),
    onToggleReaction: vi.fn(),
    onEditComment: vi.fn(),
    onDeleteComment: vi.fn(),
    onResolveComment: vi.fn(),
  };
  const handlers = { onOpenThread: vi.fn(), onBack: vi.fn(), onEngage: vi.fn() };
  const view = (threadId: string | null) => (
    <DiscussionContextProvider items={ITEMS as any[]} {...writes} {...value}>
      <CommentsPage threadId={threadId} backLabel="Acme Corp" {...handlers} {...props} />
    </DiscussionContextProvider>
  );
  const utils = render(view(props.threadId ?? null));
  return { ...writes, ...handlers, rerenderAt: (threadId: string | null) => utils.rerender(view(threadId)) };
}

const page = () => screen.getByRole('dialog');
const commentEl = (id: string) => document.querySelector(`[data-comment-id="${id}"]`) as HTMLElement;
const sheet = () => document.querySelector('[data-comment-action-sheet]') as HTMLElement | null;

function hold(el: HTMLElement) {
  fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, clientX: 10, clientY: 10 });
  act(() => {
    vi.advanceTimersByTime(COMMENT_LONG_PRESS_MS);
  });
  fireEvent.pointerUp(el, { pointerType: 'touch' });
  fireEvent.click(el);
}

describe('CommentsPage — the list', () => {
  it('shows the top-level comments with their reply count, and no reply', () => {
    renderPage();
    expect(page()).toHaveAttribute('data-comments-page', 'list');
    const roots = Array.from(document.querySelectorAll('[data-comments-list] [data-comment-thread] > [data-comment-item]')).map(
      (el) => el.getAttribute('data-comment-id'),
    );
    expect(roots).toEqual(['c1', 'c2']);
    expect(screen.getByRole('button', { name: /2 replies/ })).toBeInTheDocument();
    expect(screen.queryByText('first reply')).toBeNull();
    expect(screen.queryByText('stage changed')).toBeNull();
    expect(within(page()).getByRole('heading', { name: 'Comments' })).toBeInTheDocument();
  });

  it('a tap on a comment or its reply count opens the thread; a tap on a reaction is the reaction', () => {
    const { onOpenThread, onToggleReaction } = renderPage();
    fireEvent.click(screen.getByText('second thread'));
    expect(onOpenThread).toHaveBeenLastCalledWith('c2');
    fireEvent.click(screen.getByRole('button', { name: /2 replies/ }));
    expect(onOpenThread).toHaveBeenLastCalledWith('c1');
    onOpenThread.mockClear();
    fireEvent.click(commentEl('c1').querySelector('[data-comment-reaction="👍"]')!);
    expect(onToggleReaction).toHaveBeenCalledWith('c1', '👍');
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it('a focused comment opens on Enter', () => {
    const { onOpenThread } = renderPage();
    fireEvent.keyDown(commentEl('c2'), { key: 'Enter' });
    expect(onOpenThread).toHaveBeenCalledWith('c2');
  });

  it('「‹」 names the record and goes back', () => {
    const { onBack } = renderPage();
    const back = within(page()).getByRole('button', { name: /Acme Corp/ });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('the docked box writes a new comment and names no keyboard shortcut', async () => {
    const { onAddComment, onAddReply } = renderPage();
    const dock = document.querySelector('[data-comments-composer="comment"]') as HTMLElement;
    const box = within(dock).getByRole('textbox');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'hello' } });
    const toolbar = dock.querySelector('[data-composer-toolbar="phone"]') as HTMLElement;
    expect(within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Mention someone',
      'Bold',
      'Italic',
      'List',
      'Inline code',
      'Send',
    ]);
    await act(async () => {
      fireEvent.click(within(toolbar).getByRole('button', { name: 'Send' }));
    });
    expect(onAddComment).toHaveBeenCalledWith('hello');
    expect(onAddReply).not.toHaveBeenCalled();
    expect(page().innerHTML).not.toMatch(/Ctrl/);
  });
});

describe('CommentsPage — a thread', () => {
  it('shows the comment first and its replies after it, and replies to the thread', async () => {
    const { onAddReply, onAddComment } = renderPage({ threadId: 'c1' });
    expect(page()).toHaveAttribute('data-comments-page', 'thread');
    const thread = document.querySelector('[data-comments-thread]') as HTMLElement;
    const order = Array.from(thread.querySelectorAll('[data-comment-item]')).map((el) => el.getAttribute('data-comment-id'));
    expect(order).toEqual(['c1', 'r1', 'r2']);
    expect(within(page()).getByRole('button', { name: /Comments/ })).toHaveAttribute('data-comments-page-back');
    const dock = document.querySelector('[data-comments-composer="reply"]') as HTMLElement;
    const box = within(dock).getByRole('textbox');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'me too' } });
    await act(async () => {
      fireEvent.click(within(dock).getByRole('button', { name: 'Send' }));
    });
    expect(onAddReply).toHaveBeenCalledWith('c1', 'me too');
    expect(onAddComment).not.toHaveBeenCalled();
  });

  it('a thread that is not here shows the list', () => {
    renderPage({ threadId: 'gone' });
    expect(page()).toHaveAttribute('data-comments-page', 'list');
  });

  it('keeps the list draft while a thread is open', () => {
    const { rerenderAt } = renderPage();
    const listBox = () =>
      within(document.querySelector('[data-comments-composer="comment"]') as HTMLElement).getByRole('textbox');
    fireEvent.focus(listBox());
    fireEvent.change(listBox(), { target: { value: 'half written' } });
    rerenderAt('c2');
    rerenderAt(null);
    expect(listBox()).toHaveValue('half written');
  });
});

describe('CommentsPage — the long press', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("raises the reactions, Mark resolved, Edit and Delete on the viewer's own comment, and the release opens nothing", () => {
    const { onOpenThread, onEngage } = renderPage();
    hold(commentEl('c1'));
    expect(sheet()).not.toBeNull();
    expect(onOpenThread).not.toHaveBeenCalled();
    expect(onEngage).toHaveBeenCalledTimes(1);
    const emojis = Array.from(sheet()!.querySelectorAll('[data-comment-emoji]')).map((el) => el.getAttribute('data-comment-emoji'));
    expect(emojis).toHaveLength(6);
    expect(sheet()!.querySelector('[data-comment-emoji="👍"]')).toHaveAttribute('aria-pressed', 'true');
    const rows = Array.from(sheet()!.querySelectorAll('[data-comment-action]')).map((el) => el.getAttribute('data-comment-action'));
    expect(rows).toEqual(['resolve', 'edit', 'delete']);
  });

  it("offers no Edit or Delete on another person's comment", () => {
    renderPage();
    hold(commentEl('c2'));
    const rows = Array.from(sheet()!.querySelectorAll('[data-comment-action]')).map((el) => el.getAttribute('data-comment-action'));
    expect(rows).not.toContain('edit');
    expect(rows).not.toContain('delete');
    expect(sheet()!.querySelectorAll('[data-comment-emoji]')).toHaveLength(6);
  });

  it('offers Mark resolved on the thread’s comment only, never on a reply', () => {
    renderPage({ threadId: 'c1' });
    hold(commentEl('r2'));
    const rows = Array.from(sheet()!.querySelectorAll('[data-comment-action]')).map((el) => el.getAttribute('data-comment-action'));
    expect(rows).toEqual(['edit', 'delete']);
  });

  it('a reaction in the sheet toggles it and closes the sheet; Delete goes to the host', () => {
    const { onToggleReaction, onDeleteComment } = renderPage();
    hold(commentEl('c1'));
    fireEvent.click(sheet()!.querySelector('[data-comment-emoji="🎉"]')!);
    expect(onToggleReaction).toHaveBeenCalledWith('c1', '🎉');
    hold(commentEl('c1'));
    fireEvent.click(sheet()!.querySelector('[data-comment-action="delete"]')!);
    expect(onDeleteComment).toHaveBeenCalledWith('c1');
  });

  it('a press that travels is a scroll, not a hold', () => {
    renderPage();
    const el = commentEl('c2');
    fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(el, { pointerType: 'touch', clientX: 10, clientY: 40 });
    act(() => {
      vi.advanceTimersByTime(COMMENT_LONG_PRESS_MS);
    });
    expect(sheet()).toBeNull();
  });

  it('the context menu raises the same sheet', () => {
    renderPage();
    fireEvent.contextMenu(commentEl('c2'));
    expect(sheet()).not.toBeNull();
  });

  it('a read-only discussion raises no sheet and docks no box', () => {
    render(
      <DiscussionContextProvider items={ITEMS as any[]}>
        <CommentsPage threadId={null} backLabel="Acme" onOpenThread={vi.fn()} onBack={vi.fn()} />
      </DiscussionContextProvider>,
    );
    expect(document.querySelector('[data-comments-composer]')).toBeNull();
    hold(commentEl('c2'));
    expect(sheet()).toBeNull();
  });
});

describe('CommentsPage — the filter', () => {
  it('hides resolved threads by default and shows them from the filter', () => {
    const items = ITEMS.map((i) => (i.id === 'c2' ? { ...i, resolved: true } : i));
    render(
      <DiscussionContextProvider items={items as any[]}>
        <CommentsPage threadId={null} backLabel="Acme" onOpenThread={vi.fn()} onBack={vi.fn()} />
      </DiscussionContextProvider>,
    );
    expect(screen.queryByText('second thread')).toBeNull();
    expect(document.querySelector('[data-comments-filter]')).not.toBeNull();
  });
});
