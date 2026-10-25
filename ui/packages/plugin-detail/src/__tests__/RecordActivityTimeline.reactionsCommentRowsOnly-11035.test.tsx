/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The reaction control renders only on a feed row that can store a reaction
 * (objectui#11035).
 *
 * A reaction is stored in `sys_comment.reactions`, and `comment` is the one
 * feed kind built from a `sys_comment` row. The timeline used to render the
 * Add reaction button on EVERY root row, so an activity row (a field change, a
 * completed task, a system event, all read from `sys_activity`) offered a
 * control whose click handed the host the activity's id, and the record page's
 * host writes `sys_comment` by whatever id it is handed.
 *
 * Real subjects: `RecordActivityTimeline` and `ReactionPicker`, and the
 * activity rows are built by `activityRowToFeedItem`, the reading the record
 * page itself merges `sys_activity` rows through. The observed channel is the
 * `onToggleReaction` spy: which ids a click can hand the host.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { FeedItemType as FeedItemTypeEnum, SYS_ACTIVITY_BUILTIN_TYPES } from '@objectstack/spec/data';
import type { FeedItem, FeedItemType, Reaction } from '@object-ui/types';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import { activityRowToFeedItem } from '../renderers/recordActivityFeed';
import { DETAIL_DEFAULT_TRANSLATIONS } from '../useDetailTranslation';

const ADD_REACTION = DETAIL_DEFAULT_TRANSLATIONS['detail.addReaction'];
const COMMENT_BODY = 'Signed the renewal';
const ACTIVITY_SUMMARY = 'Created the record';
const REACTIONS: Reaction[] = [{ emoji: '👍', count: 2, reacted: false }];

const COMMENT: FeedItem = {
  id: 'c1',
  type: 'comment',
  actor: 'Grace',
  body: COMMENT_BODY,
  createdAt: '2026-09-28T08:00:00.000Z',
};

/** One `sys_activity` row as the record page reads it. */
function activityRow(type: string, id = 'a1') {
  return {
    id,
    type,
    summary: ACTIVITY_SUMMARY,
    actor_name: 'Ada',
    timestamp: '2026-09-28T07:00:00.000Z',
  };
}

function mount(items: FeedItem[], onToggleReaction = vi.fn()) {
  render(
    <RecordActivityTimeline
      items={items}
      config={{ enableReactions: true }}
      onToggleReaction={onToggleReaction}
    />,
  );
  return onToggleReaction;
}

/** The content column of the row whose body reads `body`: where its reaction controls render. */
function row(body: string): HTMLElement {
  const content = screen.getByText(body).parentElement;
  if (!content) throw new Error(`no row for "${body}"`);
  return content;
}

/** The reaction chip for `emoji` inside `scope`. */
function chipIn(scope: HTMLElement, emoji: string): HTMLButtonElement {
  const found = within(scope)
    .queryAllByRole('button')
    .find((b) => b.children.length === 2 && b.children[0].textContent === emoji);
  if (!found) throw new Error(`no ${emoji} chip in this row`);
  return found as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the reaction control renders only on a row that can store a reaction (objectui#11035)', () => {
  it('a mixed feed offers Add reaction on the comment row and not on the activity row', () => {
    const activity = activityRowToFeedItem(activityRow('created'), 'System');
    expect(activity).not.toBeNull();
    const onToggleReaction = mount([activity as FeedItem, COMMENT]);

    expect(screen.getAllByRole('button', { name: ADD_REACTION })).toHaveLength(1);
    expect(within(row(ACTIVITY_SUMMARY)).queryByRole('button', { name: ADD_REACTION })).toBeNull();
    const add = within(row(COMMENT_BODY)).getByRole('button', { name: ADD_REACTION });

    fireEvent.click(add);
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '👍' }));
    expect(onToggleReaction).toHaveBeenCalledTimes(1);
    expect(onToggleReaction).toHaveBeenCalledWith('c1', '👍');
  });

  // Every `sys_activity` row the record page can merge, the built-in types and
  // an author-extended one (which renders through the unmapped fallback): none
  // reaches the timeline as a `comment`, so none offers a reaction. The types
  // the reading drops (`commented` / `mentioned` / `login` / `logout`, which
  // are not record activity) never reach a panel, so they are not cases here.
  const mergedActivityTypes = [...SYS_ACTIVITY_BUILTIN_TYPES, 'author_extended_kind'].filter(
    (type) => activityRowToFeedItem(activityRow(type), 'System') !== null,
  );
  it('the built-in and author-extended activity types are cases here, not an empty list', () => {
    expect(mergedActivityTypes).toContain('created');
    expect(mergedActivityTypes).toContain('author_extended_kind');
  });
  it.each(mergedActivityTypes)('a `sys_activity` row of type %s offers no reaction', (type) => {
    const activity = activityRowToFeedItem(activityRow(type), 'System') as FeedItem;
    const onToggleReaction = mount([activity, COMMENT]);
    expect(within(row(ACTIVITY_SUMMARY)).queryByRole('button', { name: ADD_REACTION })).toBeNull();
    // CONTROL: the same panel still offers it on the comment.
    expect(within(row(COMMENT_BODY)).getByRole('button', { name: ADD_REACTION })).toBeTruthy();
    expect(onToggleReaction).not.toHaveBeenCalled();
  });

  const otherKinds = (FeedItemTypeEnum.options as FeedItemType[]).filter((kind) => kind !== 'comment');
  it.each(otherKinds)('a %s row carrying reactions shows them, with no Add reaction and no clickable chip', (kind) => {
    const onToggleReaction = mount([
      { id: 'x1', type: kind, actor: 'Ada', body: ACTIVITY_SUMMARY, createdAt: '2026-09-28T07:00:00.000Z', reactions: REACTIONS },
    ]);
    const scope = row(ACTIVITY_SUMMARY);
    expect(within(scope).queryByRole('button', { name: ADD_REACTION })).toBeNull();
    const chip = chipIn(scope, '👍');
    expect(chip.disabled).toBe(true);
    fireEvent.click(chip);
    expect(onToggleReaction).not.toHaveBeenCalled();
  });

  it('a comment row carrying reactions keeps its clickable chips and its Add reaction', () => {
    const onToggleReaction = mount([{ ...COMMENT, reactions: REACTIONS }]);
    const scope = row(COMMENT_BODY);
    expect(within(scope).getByRole('button', { name: ADD_REACTION })).toBeTruthy();
    const chip = chipIn(scope, '👍');
    expect(chip.disabled).toBe(false);
    fireEvent.click(chip);
    expect(onToggleReaction).toHaveBeenCalledWith('c1', '👍');
  });
});
