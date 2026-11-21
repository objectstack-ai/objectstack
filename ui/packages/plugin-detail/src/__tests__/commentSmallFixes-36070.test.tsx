/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Three of the comment fixes of objectstack#36070, in the shared pieces the
 * comment panel of #36075 reuses:
 *
 *  - Reply puts the caret in the reply input; on a comment whose replies are
 *    collapsed it expands them first (`ThreadedReplies`' `focusReplyOnOpen`).
 *  - Every comment and reply leads with its author's 20 px avatar, or their
 *    initials on the round disc the person chips draw (`CommentAuthorAvatar`),
 *    never the comment icon.
 *  - The mention menu opens under the caret, or above it when the window has
 *    no room under it (`RichTextCommentInput`). jsdom lays nothing out, so the
 *    caret's place is stubbed; the measuring helper's own null-on-no-layout is
 *    pinned too.
 *
 * The fourth fix, the toast after a delete, is the host's: it is pinned in
 * `@object-ui/app-shell`'s `RecordDetailView.feedCommentEditDelete-12268.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import type { FeedItem } from '@object-ui/types';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import { ThreadedReplies } from '../ThreadedReplies';
import { RichTextCommentInput } from '../RichTextCommentInput';
import { DETAIL_DEFAULT_TRANSLATIONS } from '../useDetailTranslation';
import { getTextareaCaretCoordinates, type CaretCoordinates } from '../textareaCaret';

// The caret's place, stubbed per test; `undefined` runs the real helper.
const caretStub = vi.hoisted(() => ({ answer: undefined as CaretCoordinates | null | undefined }));
vi.mock('../textareaCaret', async (importOriginal) => {
  const real = await importOriginal<typeof import('../textareaCaret')>();
  return {
    getTextareaCaretCoordinates: (textarea: HTMLTextAreaElement, position: number) =>
      caretStub.answer === undefined ? real.getTextareaCaretCoordinates(textarea, position) : caretStub.answer,
  };
});

const REPLY_PLACEHOLDER = DETAIL_DEFAULT_TRANSLATIONS['detail.replyPlaceholder'];

const PARENT: FeedItem = {
  id: 'c1',
  type: 'comment',
  actor: 'Grace Hopper',
  body: 'Parent comment',
  createdAt: '2026-10-01T08:00:00.000Z',
  replyCount: 1,
};
const REPLY: FeedItem = {
  id: 'c2',
  type: 'comment',
  actor: 'Ada',
  body: 'A reply to the parent',
  createdAt: '2026-10-01T09:00:00.000Z',
  parentId: 'c1',
};
const LONE: FeedItem = { ...PARENT, id: 'c3', body: 'No replies yet', replyCount: 0 };

afterEach(() => {
  cleanup();
  caretStub.answer = undefined;
  vi.restoreAllMocks();
});

function timeline(items: FeedItem[]) {
  return render(
    <RecordActivityTimeline items={items} config={{ enableThreading: true }} onAddReply={() => {}} />,
  );
}

describe('Reply puts the caret in the reply input (objectstack#36070)', () => {
  it('on a comment with no replies, the input opens focused, so typing goes into the reply', () => {
    const { container } = timeline([LONE]);
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-feed-reply-toggle]')!);
    const input = screen.getByPlaceholderText(REPLY_PLACEHOLDER);
    expect(document.activeElement).toBe(input);
  });

  it('on a comment whose reply is collapsed, Reply expands it and focuses the input', () => {
    const { container } = timeline([PARENT, REPLY]);
    // Collapsed: the count shows, the reply does not.
    expect(screen.queryByText(REPLY.body!)).toBeNull();
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-feed-reply-toggle]')!);
    expect(screen.getByText(REPLY.body!)).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByPlaceholderText(REPLY_PLACEHOLDER));
  });

  it('CONTROL: a host that always shows the input (the default) does not pull focus on mount', () => {
    render(<ThreadedReplies parentItem={PARENT} replies={[REPLY]} onAddReply={() => {}} />);
    expect(screen.getByPlaceholderText(REPLY_PLACEHOLDER)).not.toBe(document.activeElement);
    expect(screen.queryByText(REPLY.body!)).toBeNull();
  });
});

describe('every comment and reply leads with its author avatar (objectstack#36070)', () => {
  it('without an image: the initials disc, the person chips\' initials, on the comment and on the reply', () => {
    const { container } = timeline([PARENT, REPLY]);
    fireEvent.click(screen.getByRole('button', { name: /1 reply/ }));
    const avatars = container.querySelectorAll('[data-comment-author-avatar]');
    expect(avatars).toHaveLength(2);
    // "Grace Hopper" → "GH"; "Ada" → "AD" (getPersonInitials).
    expect(avatars[0]).toHaveTextContent('GH');
    expect(avatars[1]).toHaveTextContent('AD');
    expect(avatars[0].className).toMatch(/\bsize-5\b/);
    expect(avatars[0].className).toMatch(/\brounded-full\b/);
  });

  it('a CJK name draws its given-name characters, as the person chips do', () => {
    const { container } = timeline([{ ...LONE, actor: '王小明' }]);
    expect(within(container.querySelector('[data-comment-author-avatar]')! as HTMLElement).getByText('小明')).toBeInTheDocument();
  });
});

describe('the mention menu opens at the caret (objectstack#36070)', () => {
  const SUGGESTIONS = [{ id: 'u1', label: 'Grace' }, { id: 'u2', label: 'Ada' }];

  function typeAt(text: string) {
    function Host() {
      const [value, setValue] = React.useState('');
      return <RichTextCommentInput value={value} onChange={setValue} mentionSuggestions={SUGGESTIONS} />;
    }
    const { container } = render(<Host />);
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: text, selectionStart: text.length, selectionEnd: text.length } });
    return container.querySelector<HTMLElement>('[data-mention-menu]');
  }

  it('under the caret\'s line, at its left, when there is room under it', () => {
    caretStub.answer = { top: 28, left: 60, height: 20 };
    // jsdom lays out nothing: give the editor box a width the menu fits in.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    const menu = typeAt('line one\nmid @');
    expect(menu).not.toBeNull();
    expect(menu!.dataset.mentionMenu).toBe('below');
    // Line bottom 48 + the 4 px gap.
    expect(menu!.style.top).toBe('52px');
    expect(menu!.style.left).toBe('60px');
  });

  it('a caret near the right edge keeps the whole menu inside the editor box', () => {
    caretStub.answer = { top: 8, left: 380, height: 20 };
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    const menu = typeAt('@');
    // 400 - the 224 px menu.
    expect(menu!.style.left).toBe('176px');
  });

  it('above the caret\'s line when the window has no room under it', () => {
    caretStub.answer = { top: 28, left: 60, height: 20 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight - 60, bottom: window.innerHeight, left: 0, right: 300, width: 300, height: 60, x: 0, y: window.innerHeight - 60, toJSON: () => ({}),
    } as DOMRect);
    const menu = typeAt('mid @');
    expect(menu!.dataset.mentionMenu).toBe('above');
    expect(menu!.style.bottom).not.toBe('');
    expect(menu!.style.top).toBe('');
  });

  it('CONTROL: where the caret cannot be measured, the menu keeps its old place over the editor', () => {
    caretStub.answer = null;
    const menu = typeAt('@');
    expect(menu!.dataset.mentionMenu).toBe('');
    expect(menu!.className).toMatch(/\bbottom-full\b/);
  });

  it('the measuring helper answers null in a DOM that lays nothing out', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'abc';
    document.body.appendChild(textarea);
    expect(getTextareaCaretCoordinates(textarea, 3)).toBeNull();
    textarea.remove();
  });
});
