/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `isCommentAuthor` is the one owner rule for a comment's Edit and Delete, and
 * `CommentThread` reads it rather than a copy of it (objectui#12268).
 *
 * The console's record feed asks the same exported predicate for every
 * `sys_comment` row it maps (`RecordDetailView` in `@object-ui/app-shell`;
 * that half is pinned there). So the thread here is pinned on the call, not
 * only on the outcome: an inline comparison would draw the same buttons for
 * these comments and leave the spy below uncalled.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { COLLAB_DEFAULT_TRANSLATIONS } from '../useCollaborationTranslation';

const spy = vi.hoisted(() => ({ calls: [] as Array<[unknown, unknown]> }));

vi.mock('../commentAuthorship', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../commentAuthorship')>();
  return {
    isCommentAuthor: (authorId: string | null | undefined, viewerId: string | null | undefined) => {
      spy.calls.push([authorId, viewerId]);
      return actual.isCommentAuthor(authorId, viewerId);
    },
  };
});

import { CommentThread, type Comment } from '../CommentThread';
import { isCommentAuthor } from '../index';

const EDIT = COLLAB_DEFAULT_TRANSLATIONS['common.edit'];
const DELETE = COLLAB_DEFAULT_TRANSLATIONS['common.delete'];

const alice = { id: 'u_alice', name: 'Alice Chen' };
const bob = { id: 'u_bob', name: 'Bob Ito' };
const now = new Date().toISOString();

afterEach(() => {
  cleanup();
  spy.calls.length = 0;
});

describe('isCommentAuthor — the owner rule (objectui#12268)', () => {
  it('matches the author and nobody else', () => {
    expect(isCommentAuthor('u_alice', 'u_alice')).toBe(true);
    expect(isCommentAuthor('u_alice', 'u_bob')).toBe(false);
  });

  it('two absent ids are no match: a viewer with no id wrote nothing, and a row with no author is nobody\'s', () => {
    expect(isCommentAuthor(undefined, undefined)).toBe(false);
    expect(isCommentAuthor(null, null)).toBe(false);
    expect(isCommentAuthor('', '')).toBe(false);
    expect(isCommentAuthor(undefined, 'u_alice')).toBe(false);
    expect(isCommentAuthor('u_alice', undefined)).toBe(false);
  });
});

describe('CommentThread gates Edit and Delete on that rule (objectui#12268)', () => {
  function renderThread(comments: Comment[], currentUser: { id: string; name: string }) {
    return render(
      <CommentThread
        threadId="t_1"
        comments={comments}
        currentUser={currentUser}
        onEditComment={() => {}}
        onDeleteComment={() => {}}
      />,
    );
  }

  it("the author's comment offers both, another's offers neither, and each comment asked the rule", () => {
    renderThread(
      [
        { id: 'c1', author: alice, content: 'Mine', mentions: [], createdAt: now },
        { id: 'c2', author: bob, content: 'Theirs', mentions: [], createdAt: now },
      ],
      alice,
    );
    const mine = screen.getByText('Mine').closest('[data-comment-id]') as HTMLElement;
    const theirs = screen.getByText('Theirs').closest('[data-comment-id]') as HTMLElement;
    expect(within(mine).getByText(EDIT)).toBeTruthy();
    expect(within(mine).getByText(DELETE)).toBeTruthy();
    expect(within(theirs).queryByText(EDIT)).toBeNull();
    expect(within(theirs).queryByText(DELETE)).toBeNull();
    expect(spy.calls).toContainEqual(['u_alice', 'u_alice']);
    expect(spy.calls).toContainEqual(['u_bob', 'u_alice']);
  });

  it('a comment with an empty author id shows no controls to a viewer with an empty id', () => {
    const nobody = { id: '', name: 'Nobody' };
    renderThread([{ id: 'c1', author: nobody, content: 'Orphan', mentions: [], createdAt: now }], nobody);
    expect(screen.queryByText(EDIT)).toBeNull();
    expect(screen.queryByText(DELETE)).toBeNull();
  });
});
