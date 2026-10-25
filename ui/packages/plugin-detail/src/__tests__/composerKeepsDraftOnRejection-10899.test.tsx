// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A comment composer treats a REJECTED `onAddComment` / `onAddReply` as "not
 * written": it keeps the draft for a retry and swallows nothing silently —
 * reporting the failure is the host's job (objectui#10899 item 2).
 *
 * The console host (`RecordDetailView`) now appends a comment only after its
 * `sys_comment` write resolves, and rejects back to the composer when the write
 * fails. The composers awaited the callback inside `try/finally` with no
 * `catch`, so that rejection escaped as an unhandled promise rejection AND —
 * the part a user feels — the draft was only kept by accident of the throw
 * skipping `setCommentText('')`. The contract is now explicit on all three
 * composers and pinned here, with a resolving callback as the control.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { FeedItem } from '@object-ui/types';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import { ThreadedReplies } from '../ThreadedReplies';
import { RecordComments } from '../RecordComments';
import { DETAIL_DEFAULT_TRANSLATIONS } from '../useDetailTranslation';

const COMMENT_PLACEHOLDER = DETAIL_DEFAULT_TRANSLATIONS['detail.leaveCommentPlaceholder'];
const SUBMIT_COMMENT = DETAIL_DEFAULT_TRANSLATIONS['detail.submitComment'];
const REPLY_PLACEHOLDER = DETAIL_DEFAULT_TRANSLATIONS['detail.replyPlaceholder'];
const ADD_COMMENT_PLACEHOLDER = DETAIL_DEFAULT_TRANSLATIONS['detail.addCommentPlaceholder'];

const ROOT: FeedItem = {
  id: 'c-root',
  type: 'comment',
  actor: 'Grace',
  body: 'root comment',
  createdAt: '2026-01-02T00:00:00.000Z',
  replyCount: 1,
};

afterEach(() => cleanup());

describe('RecordActivityTimeline composer (objectui#10899)', () => {
  it('keeps the draft when the host rejects the comment', async () => {
    const onAddComment = vi.fn(async () => { throw new Error('404 sys_comment'); });
    render(<RecordActivityTimeline items={[]} onAddComment={onAddComment} />);

    const box = screen.getByPlaceholderText(COMMENT_PLACEHOLDER) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'not written' } });
    fireEvent.click(screen.getByTitle(SUBMIT_COMMENT));

    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith('not written', undefined));
    // Re-enabled for a retry, with the text still there.
    await waitFor(() => expect(box).not.toBeDisabled());
    expect(box.value).toBe('not written');
  });

  it('CONTROL — clears the draft when the host resolves', async () => {
    const onAddComment = vi.fn(async () => {});
    render(<RecordActivityTimeline items={[]} onAddComment={onAddComment} />);

    const box = screen.getByPlaceholderText(COMMENT_PLACEHOLDER) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'written' } });
    fireEvent.click(screen.getByTitle(SUBMIT_COMMENT));

    await waitFor(() => expect(box.value).toBe(''));
  });
});

describe('ThreadedReplies reply input (objectui#10899)', () => {
  it('keeps the reply draft when the host rejects the reply', async () => {
    const onAddReply = vi.fn(async () => { throw new Error('404 sys_comment'); });
    render(<ThreadedReplies parentItem={ROOT} replies={[]} onAddReply={onAddReply} showReplyInput />);

    const input = screen.getByPlaceholderText(REPLY_PLACEHOLDER) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'reply not written' } });
    fireEvent.click(screen.getByLabelText('Send reply'));

    await waitFor(() => expect(onAddReply).toHaveBeenCalledWith('c-root', 'reply not written'));
    await waitFor(() => expect(input).not.toBeDisabled());
    expect(input.value).toBe('reply not written');
  });

  it('CONTROL — clears the reply draft when the host resolves', async () => {
    const onAddReply = vi.fn(async () => {});
    render(<ThreadedReplies parentItem={ROOT} replies={[]} onAddReply={onAddReply} showReplyInput />);

    const input = screen.getByPlaceholderText(REPLY_PLACEHOLDER) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'reply written' } });
    fireEvent.click(screen.getByLabelText('Send reply'));

    await waitFor(() => expect(input.value).toBe(''));
  });
});

describe('RecordComments composer (objectui#10899)', () => {
  it('keeps the draft when the host rejects, clears it when the host resolves', async () => {
    const onAddComment = vi.fn(async (text: string) => {
      if (text === 'rejected') throw new Error('404 sys_comment');
    });
    render(<RecordComments comments={[]} onAddComment={onAddComment} />);

    const box = screen.getByPlaceholderText(ADD_COMMENT_PLACEHOLDER) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'rejected' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith('rejected'));
    await waitFor(() => expect(box).not.toBeDisabled());
    expect(box.value).toBe('rejected');

    fireEvent.change(box, { target: { value: 'accepted' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(box.value).toBe(''));
  });
});
