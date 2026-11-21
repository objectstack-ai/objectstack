/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The comment panel's resolved threads and its filter (objectstack#36075
 * items 3, 6, 7, 8; the backend is #36071):
 *
 * - ✓ on a thread's top-level comment resolves it, only where the rows say
 *   the deployment stores resolution; a resolved thread leaves the list and
 *   the icon's count drops by one.
 * - The filter menu: 「显示已解决」 shows them, marked with who resolved them,
 *   and their ✓ reopens; 「只看我参与的」 keeps the threads the viewer started,
 *   replied in or is mentioned in.
 * - Edit and Delete on OTHER people's comments only where the host says the
 *   viewer may moderate this record's comments.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { DiscussionContextProvider, type DiscussionContextValue } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { CommentsPanel } from './CommentsPanel';
import { useRecordComments } from './useRecordComments';

afterEach(() => cleanup());

const at = (minute: number) => new Date(Date.UTC(2026, 10, 21, 9, minute)).toISOString();

// t1: the viewer's, open. t2: Grace's, resolved by Ada (named by the host).
// t3: Linus's, open, the viewer replied. t4: Grace's, open, mentions the
// viewer. t5: Linus's, open, the viewer nowhere in it.
const ITEMS: FeedItem[] = [
  { id: 't1', type: 'comment', actor: 'Me', body: 'mine', createdAt: at(1), authoredByViewer: true, resolved: false },
  {
    id: 't2',
    type: 'comment',
    actor: 'Grace',
    body: 'settled one',
    createdAt: at(2),
    resolved: true,
    resolvedById: 'u-ada',
    resolvedByName: 'Ada',
  },
  { id: 't3', type: 'comment', actor: 'Linus', body: 'asked by linus', createdAt: at(3), resolved: false },
  { id: 'r3', type: 'comment', actor: 'Me', body: 'my answer', createdAt: at(4), parentId: 't3', authoredByViewer: true },
  { id: 't4', type: 'comment', actor: 'Grace', body: 'hey @me', createdAt: at(5), resolved: false, mentionsViewer: true },
  { id: 't5', type: 'comment', actor: 'Linus', body: 'not about me', createdAt: at(6), resolved: false },
];

function renderPanel(value: Partial<DiscussionContextValue> = {}) {
  const writes = {
    onAddComment: vi.fn(),
    onAddReply: vi.fn(),
    onEditComment: vi.fn(),
    onDeleteComment: vi.fn(),
    onResolveComment: vi.fn(),
  };
  render(
    <DiscussionContextProvider items={ITEMS as any[]} {...writes} {...value}>
      <CommentsPanel onClose={vi.fn()} />
    </DiscussionContextProvider>,
  );
  return writes;
}

const shownRoots = () =>
  Array.from(document.querySelectorAll('[data-comment-thread] > [data-comment-item]')).map((el) =>
    el.getAttribute('data-comment-id'),
  );
const commentEl = (id: string) => document.querySelector(`[data-comment-id="${id}"]`) as HTMLElement;
const actionIn = (id: string, action: string) =>
  commentEl(id).querySelector(`:scope > [data-comment-actions] [data-comment-action="${action}"]`) as HTMLElement | null;

async function toggleFilter(name: string) {
  const trigger = document.querySelector('[data-comments-filter]') as HTMLElement;
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByRole('menuitemcheckbox', { name }));
}

describe('CommentsPanel — resolved threads (objectstack#36075)', () => {
  it('hides resolved threads by default', () => {
    renderPanel();
    expect(shownRoots()).toEqual(['t1', 't3', 't4', 't5']);
  });

  it('✓ on a top-level comment resolves its thread; a reply has none', () => {
    const { onResolveComment } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /1 reply/ }));
    expect(actionIn('r3', 'resolve')).toBeNull();
    fireEvent.click(actionIn('t5', 'resolve')!);
    expect(onResolveComment).toHaveBeenCalledWith('t5', true);
  });

  it('「显示已解决」 shows a resolved thread with its resolver, and its ✓ reopens it', async () => {
    const { onResolveComment } = renderPanel();
    await toggleFilter('Show resolved');
    expect(shownRoots()).toEqual(['t1', 't2', 't3', 't4', 't5']);
    const thread = commentEl('t2').closest('[data-comment-thread]') as HTMLElement;
    expect(thread).toHaveAttribute('data-comment-thread-resolved', 'true');
    expect(within(thread).getByText('Resolved by Ada')).toBeInTheDocument();
    expect(actionIn('t2', 'resolve')).toBeNull();
    const reopen = actionIn('t2', 'reopen')!;
    expect(reopen).toHaveAttribute('aria-pressed', 'true');
    expect(reopen).toHaveAccessibleName('Reopen');
    fireEvent.click(reopen);
    expect(onResolveComment).toHaveBeenCalledWith('t2', false);
  });

  it('「只看我参与的」 keeps the threads the viewer started, replied in or is mentioned in', async () => {
    renderPanel();
    await toggleFilter("Only threads I'm in");
    expect(shownRoots()).toEqual(['t1', 't3', 't4']);
  });

  it('names a resolver the host could not from the mention list, asking for it once', async () => {
    const onMentionSuggestionsWanted = vi.fn();
    const items = ITEMS.map((item) =>
      item.id === 't2' ? { ...item, resolvedByName: undefined, resolvedById: 'u-zoe' } : item,
    );
    const { rerender } = render(
      <DiscussionContextProvider items={items as any[]} onResolveComment={vi.fn()} onMentionSuggestionsWanted={onMentionSuggestionsWanted}>
        <CommentsPanel />
      </DiscussionContextProvider>,
    );
    await toggleFilter('Show resolved');
    const thread = () => commentEl('t2').closest('[data-comment-thread]') as HTMLElement;
    expect(within(thread()).getByText('Resolved')).toBeInTheDocument();
    expect(onMentionSuggestionsWanted).toHaveBeenCalled();
    rerender(
      <DiscussionContextProvider
        items={items as any[]}
        onResolveComment={vi.fn()}
        onMentionSuggestionsWanted={onMentionSuggestionsWanted}
        mentionSuggestions={[{ id: 'u-zoe', label: 'Zoe' }]}
      >
        <CommentsPanel />
      </DiscussionContextProvider>,
    );
    expect(within(thread()).getByText('Resolved by Zoe')).toBeInTheDocument();
  });

  it('says so when every thread is resolved, and shows them all on request', () => {
    renderPanel({ items: [ITEMS[1]] as any[] });
    expect(screen.getByText('No unresolved comments')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all comments' }));
    expect(shownRoots()).toEqual(['t2']);
  });

  it('offers no ✓ and no filter where the deployment stores no resolution, and shows every thread', () => {
    const items = ITEMS.map(({ resolved, resolvedById, resolvedByName, ...item }) => item);
    renderPanel({ items: items as any[] });
    expect(document.querySelector('[data-comments-filter]')).toBeNull();
    expect(document.querySelector('[data-comment-action="resolve"]')).toBeNull();
    expect(shownRoots()).toEqual(['t1', 't2', 't3', 't4', 't5']);
  });

  it('offers no ✓ where the host hands no resolve write', () => {
    renderPanel({ onResolveComment: undefined });
    expect(document.querySelector('[data-comment-action="resolve"]')).toBeNull();
    // The filter still sorts what is shown.
    expect(document.querySelector('[data-comments-filter]')).not.toBeNull();
  });
});

describe('CommentsPanel — Edit and Delete for people with permission (objectstack#36075 item 6)', () => {
  it('a moderator gets Edit and Delete on other people’s comments', async () => {
    const { onDeleteComment } = renderPanel({ moderatesComments: true });
    fireEvent.pointerDown(actionIn('t5', 'more')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDeleteComment).toHaveBeenCalledWith('t5');
  });

  it('CONTROL: without it, only the viewer’s own comments have More', () => {
    renderPanel({ moderatesComments: false });
    expect(actionIn('t1', 'more')).not.toBeNull();
    expect(actionIn('t5', 'more')).toBeNull();
  });

  it('moderating needs the host’s write too', () => {
    renderPanel({ moderatesComments: true, onEditComment: undefined, onDeleteComment: undefined });
    expect(actionIn('t5', 'more')).toBeNull();
  });
});

describe('useRecordComments — the icon’s count (objectstack#36075 item 8)', () => {
  const Probe: React.FC = () => <span data-testid="count">{String(useRecordComments().count)}</span>;
  it('counts the unresolved threads', () => {
    render(
      <DiscussionContextProvider items={ITEMS as any[]}>
        <Probe />
      </DiscussionContextProvider>,
    );
    expect(screen.getByTestId('count')).toHaveTextContent('4');
  });

  it('counts every thread where the deployment stores no resolution', () => {
    const items = ITEMS.map(({ resolved, ...item }) => item);
    render(
      <DiscussionContextProvider items={items as any[]}>
        <Probe />
      </DiscussionContextProvider>,
    );
    expect(screen.getByTestId('count')).toHaveTextContent('5');
  });
});
