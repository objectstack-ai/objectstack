/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The reply input does not wait for a first reply, and the reply list keeps its
 * one `replyCount` gate (objectui#12144).
 *
 * With threading on, the timeline drew `ThreadedReplies`, the only place the
 * reply input renders, only under an item whose `replyCount` was above zero.
 * Nothing set it on a comment with no replies, so such a comment never offered
 * the input and its first reply could not be posted. Now:
 *
 *  - the INPUT is offered on every comment row the host hands `onAddReply` for,
 *    replies or not, and on no other row (a reply is a `sys_comment` whose
 *    parent is a comment);
 *  - the LIST still shows only under a `replyCount` above zero, so whether a
 *    comment's replies show never depends on whether the caller may post one.
 *
 * The record page's read is what sets `replyCount`; that half is pinned through
 * the page in `@object-ui/app-shell`
 * (`RecordDetailView.replyCountOnRead-12144.test.tsx`). This file pins the
 * timeline's render condition alone.
 *
 * Real subjects: `RecordActivityTimeline` and `ThreadedReplies`; the activity
 * row is built by `activityRowToFeedItem`, the reading the record page merges
 * `sys_activity` rows through.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { FeedItem } from '@object-ui/types';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import { activityRowToFeedItem } from '../renderers/recordActivityFeed';
import { DETAIL_DEFAULT_TRANSLATIONS } from '../useDetailTranslation';

const REPLY_PLACEHOLDER = DETAIL_DEFAULT_TRANSLATIONS['detail.replyPlaceholder'];
const PARENT_BODY = 'Parent comment';
const REPLY_BODY = 'A reply to the parent';
const ACTIVITY_SUMMARY = 'Stage changed';

const PARENT: FeedItem = {
  id: 'c1',
  type: 'comment',
  actor: 'Grace',
  body: PARENT_BODY,
  createdAt: '2026-10-01T08:00:00.000Z',
};

const REPLY: FeedItem = {
  id: 'c2',
  type: 'comment',
  actor: 'Ada',
  body: REPLY_BODY,
  createdAt: '2026-10-01T09:00:00.000Z',
  parentId: 'c1',
};

const ACTIVITY = activityRowToFeedItem(
  { id: 'a1', type: 'updated', summary: ACTIVITY_SUMMARY, actor_name: 'Ada', timestamp: '2026-10-01T07:00:00.000Z' },
  'System',
) as FeedItem;

function mount(items: FeedItem[], { threading = true, onAddReply }: { threading?: boolean; onAddReply?: () => void } = {}) {
  render(<RecordActivityTimeline items={items} config={{ enableThreading: threading }} onAddReply={onAddReply} />);
}

/** The feed row a body sits in: the keyed root element holding the row and its replies. */
function rootRowOf(body: string): HTMLElement {
  const rows = screen.getByText(body).closest('.space-y-4')!.children;
  const row = Array.from(rows).find((r) => r.textContent?.includes(body));
  if (!row) throw new Error(`no feed row holds ${JSON.stringify(body)}`);
  return row as HTMLElement;
}

const replyInputs = () => screen.queryAllByPlaceholderText(REPLY_PLACEHOLDER);
const replyToggles = () => screen.queryAllByRole('button', { name: /\d+ repl/ });

afterEach(() => {
  cleanup();
});

describe('the reply input does not wait for a first reply (objectui#12144)', () => {
  it('a comment with no replies offers it when the host hands over onAddReply', () => {
    mount([PARENT], { onAddReply: vi.fn() });
    expect(within(rootRowOf(PARENT_BODY)).queryByPlaceholderText(REPLY_PLACEHOLDER)).not.toBeNull();
    expect(replyToggles()).toHaveLength(0);
  });

  it('CONTROL: without onAddReply the same comment offers none', () => {
    mount([PARENT]);
    expect(replyInputs()).toHaveLength(0);
  });

  it('a row that is not a comment offers none, beside a comment that does', () => {
    expect(ACTIVITY.type).not.toBe('comment');
    mount([ACTIVITY, PARENT], { onAddReply: vi.fn() });
    expect(within(rootRowOf(ACTIVITY_SUMMARY)).queryByPlaceholderText(REPLY_PLACEHOLDER)).toBeNull();
    expect(replyInputs()).toHaveLength(1);
  });

  it('CONTROL: with threading off no row offers it', () => {
    mount([PARENT], { threading: false, onAddReply: vi.fn() });
    expect(replyInputs()).toHaveLength(0);
  });
});

describe("the reply list keeps its one replyCount gate (objectui#12144)", () => {
  it('replies the host handed over without a replyCount stay hidden, whether or not the input is offered', () => {
    mount([PARENT, REPLY], { onAddReply: vi.fn() });
    expect(replyToggles()).toHaveLength(0);
    expect(screen.queryByText(REPLY_BODY)).toBeNull();
    expect(replyInputs()).toHaveLength(1);
  });

  it('with a replyCount above zero the list shows, and it shows without the input too', () => {
    mount([{ ...PARENT, replyCount: 1 }, REPLY]);
    expect(replyInputs()).toHaveLength(0);
    expect(within(rootRowOf(PARENT_BODY)).getAllByRole('button', { name: /1 reply/ })).toHaveLength(1);
  });
});
