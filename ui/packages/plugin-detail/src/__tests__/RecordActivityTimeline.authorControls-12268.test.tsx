/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The record feed offers a comment's author Edit and Delete on their own
 * comment and reply, and nowhere else (objectui#12268).
 *
 * Whose comment it is, the timeline never decides: the host that read the row
 * marks it `authoredByViewer` (the record page asks `@object-ui/collaboration`'s
 * `isCommentAuthor`, the rule `CommentThread` gates on). Each control is
 * offered only where three things hold: the row is a `comment`, the host
 * marked it the viewer's, and the host handed over that control's handler.
 * Every case below keeps two of the three and drops the third.
 *
 * Labels are read from `DETAIL_DEFAULT_TRANSLATIONS` by key (no provider is
 * mounted, so that map is what renders), not written out.
 *
 * The host's half (which rows it marks, the grants it hands the handlers over
 * under, the confirm, the writes and the refusals) is pinned through the real
 * record page in `RecordDetailView.feedCommentEditDelete-12268.test.tsx`
 * (`@object-ui/app-shell`).
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, act } from '@testing-library/react';
import { DiscussionContextProvider, RecordContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import { RecordActivityRenderer } from '../renderers/record-activity';
import { RecordChatterRenderer } from '../renderers/record-chatter';
import { activityRowToFeedItem } from '../renderers/recordActivityFeed';
import { DETAIL_DEFAULT_TRANSLATIONS } from '../useDetailTranslation';

const EDIT = DETAIL_DEFAULT_TRANSLATIONS['detail.editComment'];
const DELETE = DETAIL_DEFAULT_TRANSLATIONS['detail.deleteComment'];
const SAVE = DETAIL_DEFAULT_TRANSLATIONS['detail.save'];
const CANCEL = DETAIL_DEFAULT_TRANSLATIONS['detail.cancel'];
const EDITED = DETAIL_DEFAULT_TRANSLATIONS['detail.edited'];

const OWN_BODY = 'My own comment';
const OTHER_BODY = 'Somebody else wrote this';
const OWN_REPLY_BODY = 'My reply under their comment';
const OTHER_REPLY_BODY = 'Their reply under my comment';
const ACTIVITY_SUMMARY = 'Stage changed';

const OWN: FeedItem = {
  id: 'c-own',
  type: 'comment',
  actor: 'Ada',
  body: OWN_BODY,
  createdAt: '2026-10-01T08:00:00.000Z',
  authoredByViewer: true,
};

const OTHER: FeedItem = {
  id: 'c-other',
  type: 'comment',
  actor: 'Grace',
  body: OTHER_BODY,
  createdAt: '2026-10-01T09:00:00.000Z',
  authoredByViewer: false,
};

/** A `sys_activity` row, marked the viewer's: still no controls, it is no comment. */
const ACTIVITY: FeedItem = {
  ...(activityRowToFeedItem(
    { id: 'a1', type: 'updated', summary: ACTIVITY_SUMMARY, actor_name: 'Ada', timestamp: '2026-10-01T07:00:00.000Z' },
    'System',
  ) as FeedItem),
  authoredByViewer: true,
};

interface Handlers {
  onEditComment?: (id: string | number, text: string) => void | Promise<void>;
  onDeleteComment?: (id: string | number) => void | Promise<void>;
}

function mount(items: FeedItem[], handlers: Handlers = {}, threading = false) {
  return render(
    <RecordActivityTimeline
      items={items}
      config={{ enableThreading: threading }}
      onEditComment={handlers.onEditComment}
      onDeleteComment={handlers.onDeleteComment}
    />,
  );
}

/** The feed row a body sits in: the keyed root element holding the row and its replies. */
function rootRowOf(body: string): HTMLElement {
  const rows = screen.getByText(body).closest('.space-y-4')!.children;
  const row = Array.from(rows).find((r) => r.textContent?.includes(body));
  if (!row) throw new Error(`no feed row holds ${JSON.stringify(body)}`);
  return row as HTMLElement;
}

const editButtons = () => screen.queryAllByRole('button', { name: EDIT });
const deleteButtons = () => screen.queryAllByRole('button', { name: DELETE });

afterEach(() => {
  cleanup();
});

describe("a comment row offers its author's Edit and Delete only where the host marked it the viewer's (objectui#12268)", () => {
  it("the viewer's own comment offers both; another member's comment, beside it, offers neither", () => {
    mount([OWN, OTHER], { onEditComment: vi.fn(), onDeleteComment: vi.fn() });
    const own = rootRowOf(OWN_BODY);
    expect(within(own).getByRole('button', { name: EDIT })).toBeInTheDocument();
    expect(within(own).getByRole('button', { name: DELETE })).toBeInTheDocument();
    const other = rootRowOf(OTHER_BODY);
    expect(within(other).queryByRole('button', { name: EDIT })).toBeNull();
    expect(within(other).queryByRole('button', { name: DELETE })).toBeNull();
    expect(editButtons()).toHaveLength(1);
    expect(deleteButtons()).toHaveLength(1);
  });

  it('a row with no authorship answer offers neither: the timeline never derives it', () => {
    const { authoredByViewer: _unset, ...unmarked } = OWN;
    mount([unmarked], { onEditComment: vi.fn(), onDeleteComment: vi.fn() });
    expect(editButtons()).toHaveLength(0);
    expect(deleteButtons()).toHaveLength(0);
  });

  it('a row that is not a comment offers neither, even marked as the viewer\'s', () => {
    expect(ACTIVITY.type).not.toBe('comment');
    mount([ACTIVITY, OWN], { onEditComment: vi.fn(), onDeleteComment: vi.fn() });
    const activity = rootRowOf(ACTIVITY_SUMMARY);
    expect(within(activity).queryByRole('button', { name: EDIT })).toBeNull();
    expect(within(activity).queryByRole('button', { name: DELETE })).toBeNull();
    expect(editButtons()).toHaveLength(1);
  });

  it('each control follows its own handler: without the host handlers the own comment is its bare paragraph', () => {
    mount([OWN], { onEditComment: vi.fn() });
    expect(editButtons()).toHaveLength(1);
    expect(deleteButtons()).toHaveLength(0);
    cleanup();
    mount([OWN], { onDeleteComment: vi.fn() });
    expect(editButtons()).toHaveLength(0);
    expect(deleteButtons()).toHaveLength(1);
    cleanup();
    mount([OWN]);
    expect(editButtons()).toHaveLength(0);
    expect(deleteButtons()).toHaveLength(0);
    expect(rootRowOf(OWN_BODY).querySelectorAll('button')).toHaveLength(0);
  });
});

describe('Edit opens the comment text in place, and the row changes only once the host stores it (objectui#12268)', () => {
  it('Save hands the host the trimmed draft and closes the editor when the host resolves', async () => {
    const onEditComment = vi.fn(async () => {});
    mount([OWN], { onEditComment });
    fireEvent.click(within(rootRowOf(OWN_BODY)).getByRole('button', { name: EDIT }));
    const editor = screen.getByRole('textbox', { name: EDIT });
    expect(editor).toHaveValue(OWN_BODY);
    fireEvent.change(editor, { target: { value: '  My corrected comment  ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SAVE }));
    });
    expect(onEditComment).toHaveBeenCalledTimes(1);
    expect(onEditComment).toHaveBeenCalledWith('c-own', 'My corrected comment');
    expect(screen.queryByRole('textbox', { name: EDIT })).toBeNull();
  });

  it('a rejected save keeps the editor open with the draft, and the text behind it is unchanged', async () => {
    const onEditComment = vi.fn(async () => {
      throw new Error('refused');
    });
    mount([OWN], { onEditComment });
    fireEvent.click(screen.getByRole('button', { name: EDIT }));
    fireEvent.change(screen.getByRole('textbox', { name: EDIT }), { target: { value: 'An edit the server refuses' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SAVE }));
    });
    expect(onEditComment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: EDIT })).toHaveValue('An edit the server refuses');
    fireEvent.click(screen.getByRole('button', { name: CANCEL }));
    expect(screen.getByText(OWN_BODY)).toBeInTheDocument();
  });

  it('an empty or unchanged draft cannot be saved, and Cancel and Escape close the editor without a call', () => {
    const onEditComment = vi.fn();
    mount([OWN], { onEditComment });
    fireEvent.click(screen.getByRole('button', { name: EDIT }));
    expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: EDIT }), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: CANCEL }));
    expect(screen.queryByRole('textbox', { name: EDIT })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: EDIT }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: EDIT }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: EDIT })).toBeNull();
    expect(onEditComment).not.toHaveBeenCalled();
  });
});

describe('Delete hands the row to the host, which confirms and deletes (objectui#12268)', () => {
  it('a click calls the host with the row id; a rejection is the host\'s to report and leaves nothing unhandled', async () => {
    const onDeleteComment = vi.fn(async () => {
      throw new Error('refused');
    });
    mount([OWN, OTHER], { onDeleteComment });
    await act(async () => {
      fireEvent.click(within(rootRowOf(OWN_BODY)).getByRole('button', { name: DELETE }));
    });
    expect(onDeleteComment).toHaveBeenCalledTimes(1);
    expect(onDeleteComment).toHaveBeenCalledWith('c-own');
    expect(screen.getByText(OWN_BODY)).toBeInTheDocument();
  });
});

describe('an edited comment reads as edited, on a root row and on a reply (objectui#12268)', () => {
  it('the marker follows the row\'s `edited`', () => {
    mount([{ ...OWN, edited: true }, OTHER]);
    expect(within(rootRowOf(OWN_BODY)).getByText(EDITED)).toBeInTheDocument();
    expect(within(rootRowOf(OTHER_BODY)).queryByText(EDITED)).toBeNull();
  });

  it('an edited reply reads as edited under its parent', () => {
    const parent: FeedItem = { ...OTHER, replyCount: 1 };
    const reply: FeedItem = { ...OWN, id: 'r-own', body: OWN_REPLY_BODY, parentId: 'c-other', edited: true };
    mount([parent, reply], {}, true);
    const row = rootRowOf(OTHER_BODY);
    fireEvent.click(within(row).getByRole('button', { name: /1 reply/ }));
    const replyRow = within(row).getByText(OWN_REPLY_BODY).parentElement!;
    expect(within(replyRow).getByText(EDITED)).toBeInTheDocument();
  });
});

describe('a reply whose parent the feed does not hold is a row of its own, in its place (objectui#12268)', () => {
  const ORPHAN_BODY = 'A reply whose parent was deleted';
  const orphan: FeedItem = { ...OTHER, id: 'r-orphan', body: ORPHAN_BODY, parentId: 'c-deleted', createdAt: '2026-10-01T08:30:00.000Z' };

  it('with threading on it renders as a root row, between the rows it sits between in time', () => {
    mount([OWN, orphan, OTHER], {}, true);
    const list = screen.getByText(OWN_BODY).closest('.space-y-4')!;
    const rows = Array.from(list.children).map((r) => r.textContent ?? '');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain(OWN_BODY);
    expect(rows[1]).toContain(ORPHAN_BODY);
    expect(rows[2]).toContain(OTHER_BODY);
    expect(screen.queryAllByRole('button', { name: /\d+ repl/ })).toHaveLength(0);
  });

  it('CONTROL: with its parent held, the same reply nests under it, behind the toggle', () => {
    const parent: FeedItem = { ...OWN, id: 'c-deleted', replyCount: 1 };
    mount([parent, orphan, OTHER], {}, true);
    expect(screen.queryByText(ORPHAN_BODY)).toBeNull();
    fireEvent.click(within(rootRowOf(OWN_BODY)).getByRole('button', { name: /1 reply/ }));
    expect(within(rootRowOf(OWN_BODY)).getByText(ORPHAN_BODY)).toBeInTheDocument();
  });

  it('as a root row it keeps its own terms: the viewer\'s orphaned reply offers its author Edit and Delete', () => {
    mount([{ ...orphan, authoredByViewer: true }], { onEditComment: vi.fn(), onDeleteComment: vi.fn() }, true);
    const row = rootRowOf(ORPHAN_BODY);
    expect(within(row).getByRole('button', { name: EDIT })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: DELETE })).toBeInTheDocument();
  });
});

describe("a reply is a comment too: its author's Edit and Delete show on it, on the same terms (objectui#12268)", () => {
  it("the viewer's reply under another's comment offers both; another's reply under the viewer's comment offers neither", async () => {
    const theirs: FeedItem = { ...OTHER, replyCount: 1 };
    const mine: FeedItem = { ...OWN, replyCount: 1 };
    const myReply: FeedItem = { ...OWN, id: 'r-own', body: OWN_REPLY_BODY, parentId: 'c-other' };
    const theirReply: FeedItem = { ...OTHER, id: 'r-other', body: OTHER_REPLY_BODY, parentId: 'c-own' };
    const onEditComment = vi.fn(async () => {});
    mount([mine, theirs, myReply, theirReply], { onEditComment, onDeleteComment: vi.fn() }, true);
    for (const body of [OWN_BODY, OTHER_BODY]) {
      fireEvent.click(within(rootRowOf(body)).getByRole('button', { name: /1 reply/ }));
    }
    const myReplyRow = screen.getByText(OWN_REPLY_BODY).parentElement!;
    expect(within(myReplyRow).getByRole('button', { name: EDIT })).toBeInTheDocument();
    expect(within(myReplyRow).getByRole('button', { name: DELETE })).toBeInTheDocument();
    const theirReplyRow = screen.getByText(OTHER_REPLY_BODY).parentElement!;
    expect(within(theirReplyRow).queryByRole('button', { name: EDIT })).toBeNull();
    // The viewer's root comment and the viewer's reply: two of each, no more.
    expect(editButtons()).toHaveLength(2);
    expect(deleteButtons()).toHaveLength(2);

    fireEvent.click(within(myReplyRow).getByRole('button', { name: EDIT }));
    fireEvent.change(screen.getByRole('textbox', { name: EDIT }), { target: { value: 'Reply, corrected' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SAVE }));
    });
    expect(onEditComment).toHaveBeenCalledWith('r-own', 'Reply, corrected');
  });
});

describe('both feed blocks hand the host context\'s handlers to the timeline (objectui#12268)', () => {
  function withHost(node: React.ReactNode, handlers: Handlers) {
    return render(
      <RecordContextProvider objectName="crm_case" recordId="case-41" data={{ id: 'case-41' }}>
        <DiscussionContextProvider items={[OWN, OTHER] as any} {...handlers}>
          {node}
        </DiscussionContextProvider>
      </RecordContextProvider>,
    );
  }

  it('record:activity offers them on the own comment only, and CONTROL: not without the handlers', () => {
    withHost(<RecordActivityRenderer schema={{ type: 'record:activity' } as any} />, {
      onEditComment: vi.fn(),
      onDeleteComment: vi.fn(),
    });
    expect(within(rootRowOf(OWN_BODY)).getByRole('button', { name: EDIT })).toBeInTheDocument();
    expect(within(rootRowOf(OWN_BODY)).getByRole('button', { name: DELETE })).toBeInTheDocument();
    expect(editButtons()).toHaveLength(1);
    cleanup();
    withHost(<RecordActivityRenderer schema={{ type: 'record:activity' } as any} />, {});
    expect(editButtons()).toHaveLength(0);
    expect(deleteButtons()).toHaveLength(0);
  });

  it('record:discussion (the chatter panel) does the same, and CONTROL: not without the handlers', () => {
    withHost(<RecordChatterRenderer schema={{ type: 'record:discussion' } as any} />, {
      onEditComment: vi.fn(),
      onDeleteComment: vi.fn(),
    });
    expect(within(rootRowOf(OWN_BODY)).getByRole('button', { name: EDIT })).toBeInTheDocument();
    expect(within(rootRowOf(OWN_BODY)).getByRole('button', { name: DELETE })).toBeInTheDocument();
    expect(editButtons()).toHaveLength(1);
    cleanup();
    withHost(<RecordChatterRenderer schema={{ type: 'record:discussion' } as any} />, {});
    expect(editButtons()).toHaveLength(0);
    expect(deleteButtons()).toHaveLength(0);
  });
});
