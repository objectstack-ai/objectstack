/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The desktop comment panel (objectstack#36075), drawn from the host's
 * `DiscussionContext` alone:
 *
 * - 「评论」 and ✕ at the top; ✕ and Esc close it.
 * - Threads oldest first; a thread with replies shows 「N 条回复」 and opens in
 *   place; Reply on a comment opens its thread and puts the caret in the
 *   reply box, and the reply answers the thread's first comment.
 * - Each comment's actions sit in one row at its top right: Reply, React,
 *   More; Edit and Delete only on the viewer's own comments, and only where
 *   the host hands those writes. A read-only discussion offers no actions and
 *   no comment box.
 * - The comment box at the foot adds a comment, and keeps the draft when the
 *   write is refused.
 * - Empty, refused and failed reads each say so; a failed read offers Retry.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor, act } from '@testing-library/react';
import { DiscussionContextProvider, type DiscussionContextValue } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { CommentsPanel } from './CommentsPanel';
import { CommentsButton } from './CommentsButton';

afterEach(() => cleanup());

const at = (minute: number) => new Date(Date.UTC(2026, 10, 21, 9, minute)).toISOString();

const ITEMS: FeedItem[] = [
  { id: 'c2', type: 'comment', actor: 'Grace', body: 'second thread', createdAt: at(10) },
  { id: 'c1', type: 'comment', actor: 'Ada', body: 'first thread', createdAt: at(1), authoredByViewer: true },
  { id: 'r1', type: 'comment', actor: 'Grace', body: 'a reply', createdAt: at(5), parentId: 'c1' },
  { id: 'a1', type: 'field_change', actor: 'System', body: 'stage changed', createdAt: at(2) },
];

function renderPanel(value: Partial<DiscussionContextValue> = {}, onClose = vi.fn()) {
  const writes = {
    onAddComment: vi.fn(),
    onAddReply: vi.fn(),
    onToggleReaction: vi.fn(),
    onEditComment: vi.fn(),
    onDeleteComment: vi.fn(),
  };
  render(
    <DiscussionContextProvider items={ITEMS as any[]} {...writes} {...value}>
      <CommentsPanel onClose={onClose} />
    </DiscussionContextProvider>,
  );
  return { ...writes, onClose };
}

const panel = () => screen.getByRole('region', { name: 'Comments' });
const commentEl = (id: string) => document.querySelector(`[data-comment-id="${id}"]`) as HTMLElement;
const actionIn = (id: string, action: string) =>
  commentEl(id).querySelector(`:scope > [data-comment-actions] [data-comment-action="${action}"]`) as HTMLElement | null;

describe('CommentsPanel', () => {
  it('draws the threads oldest first and leaves system rows out', () => {
    renderPanel();
    expect(within(panel()).getByRole('heading', { name: 'Comments' })).toBeInTheDocument();
    const roots = Array.from(document.querySelectorAll('[data-comment-thread] > [data-comment-item]')).map((el) =>
      el.getAttribute('data-comment-id'),
    );
    expect(roots).toEqual(['c1', 'c2']);
    expect(screen.queryByText('stage changed')).toBeNull();
  });

  it('collapses a thread to its reply count and opens it in place', () => {
    renderPanel();
    expect(screen.queryByText('a reply')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /1 reply/ }));
    expect(screen.getByText('a reply')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse replies' }));
    expect(screen.queryByText('a reply')).toBeNull();
  });

  it('Reply opens the thread with the caret in the reply box, and the reply answers its first comment', async () => {
    const { onAddReply } = renderPanel();
    fireEvent.click(actionIn('c1', 'reply')!);
    const thread = commentEl('c1').closest('[data-comment-thread]') as HTMLElement;
    const box = within(thread).getByPlaceholderText('Reply…');
    await waitFor(() => expect(box).toHaveFocus());
    fireEvent.change(box, { target: { value: 'my reply' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onAddReply).toHaveBeenCalledWith('c1', 'my reply'));
  });

  it('offers Edit and Delete under More on the viewer’s own comment only', () => {
    renderPanel();
    expect(actionIn('c1', 'more')).not.toBeNull();
    expect(actionIn('c2', 'more')).toBeNull();
    expect(actionIn('c2', 'reply')).not.toBeNull();
    expect(actionIn('c2', 'react')).not.toBeNull();
  });

  it('More → Delete hands the comment to the host', async () => {
    const { onDeleteComment } = renderPanel();
    fireEvent.pointerDown(actionIn('c1', 'more')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(onDeleteComment).toHaveBeenCalledWith('c1');
  });

  it('More → Edit turns the comment into an editor that saves', async () => {
    const { onEditComment } = renderPanel();
    fireEvent.pointerDown(actionIn('c1', 'more')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const editor = within(commentEl('c1')).getByDisplayValue('first thread');
    fireEvent.change(editor, { target: { value: 'first thread, edited' } });
    fireEvent.click(within(commentEl('c1')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onEditComment).toHaveBeenCalledWith('c1', 'first thread, edited'));
  });

  it('React picks an emoji for that comment', async () => {
    const { onToggleReaction } = renderPanel();
    fireEvent.click(actionIn('c2', 'react')!);
    fireEvent.click(await screen.findByText('👍'));
    expect(onToggleReaction).toHaveBeenCalledWith('c2', '👍');
  });

  it('a read-only discussion offers no actions and no comment box', () => {
    render(
      <DiscussionContextProvider items={ITEMS as any[]}>
        <CommentsPanel onClose={vi.fn()} />
      </DiscussionContextProvider>,
    );
    expect(document.querySelector('[data-comment-actions]')).toBeNull();
    expect(document.querySelector('[data-comments-composer]')).toBeNull();
  });

  it('adds a comment from the box at the foot, and keeps the draft when the write is refused', async () => {
    const onAddComment = vi.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValueOnce(undefined);
    renderPanel({ onAddComment });
    const box = within(document.querySelector('[data-comments-composer]') as HTMLElement).getByRole('textbox');
    fireEvent.change(box, { target: { value: 'hello' } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    });
    expect(onAddComment).toHaveBeenCalledWith('hello');
    expect(box).toHaveValue('hello');
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    });
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('closes on ✕ and on Esc', () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
    fireEvent.keyDown(panel(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Esc in the @ list closes the list only: the panel stays open and the draft is kept', () => {
    const { onClose } = renderPanel({ mentionSuggestions: [{ id: 'u-zoe', label: 'Zoe' }] });
    const box = within(document.querySelector('[data-comments-composer]') as HTMLElement).getByRole('textbox');
    fireEvent.change(box, { target: { value: 'ask @', selectionStart: 5 } });
    expect(screen.getByRole('button', { name: /Zoe/ })).toBeInTheDocument();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /Zoe/ })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(box).toHaveValue('ask @');
    // CONTROL: with the list closed, the next Esc is the panel's.
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc in the More menu closes the menu only: the menu is portaled out of the panel', async () => {
    const { onClose } = renderPanel();
    fireEvent.pointerDown(actionIn('c1', 'more')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const item = await screen.findByRole('menuitem', { name: 'Delete' });
    expect(document.querySelector('[data-comments-panel]')!.contains(item)).toBe(false);
    fireEvent.keyDown(item, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says when there are no comments yet, and invites the first', () => {
    renderPanel({ items: [] });
    expect(screen.getByText('No comments yet')).toBeInTheDocument();
    expect(screen.getByText(/Write the first one below/)).toBeInTheDocument();
  });

  it('says a refused read is refused, and offers Retry on a failed one', () => {
    renderPanel({ items: [], commentsDenied: true });
    expect(document.querySelector('[data-comments-composer]')).toBeNull();
    expect(screen.queryByText('No comments yet')).toBeNull();
    cleanup();
    const onRetryFeed = vi.fn();
    renderPanel({ items: [], commentsFailed: true, onRetryFeed });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetryFeed).toHaveBeenCalled();
  });
});

describe('CommentsButton', () => {
  it('shows the count beside the icon, reads pressed while open, and toggles', () => {
    const onPressedChange = vi.fn();
    const { rerender } = render(<CommentsButton count={3} pressed={false} onPressedChange={onPressedChange} />);
    const button = screen.getByRole('button', { name: /Comments/ });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('3');
    fireEvent.click(button);
    expect(onPressedChange).toHaveBeenCalledWith(true);
    rerender(<CommentsButton count={null} pressed onPressedChange={onPressedChange} />);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.querySelector('[data-comments-count]')).toBeNull();
  });
});
