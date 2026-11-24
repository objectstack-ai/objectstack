/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * How the comment panel groups a record's discussion (objectstack#36075):
 * comment rows only, threads oldest first, a reply (or a reply to a reply)
 * inside its thread, and a reply whose parent was deleted kept as a thread of
 * its own, so a delete never hides someone else's words.
 */

import { describe, it, expect } from 'vitest';
import type { FeedItem } from '@object-ui/types';
import { buildCommentThreads, latestRepliers } from './commentThreads';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 21, 9, minute)).toISOString();

function comment(id: string, minute: number, extra: Partial<FeedItem> = {}): FeedItem {
  return { id, type: 'comment', actor: `actor-${id}`, body: id, createdAt: at(minute), ...extra };
}

const ids = (items: FeedItem[]) => items.map((item) => String(item.id));

describe('buildCommentThreads', () => {
  it('keeps only comment rows, oldest thread first', () => {
    const threads = buildCommentThreads([
      comment('b', 5),
      { id: 'act', type: 'field_change', actor: 'x', createdAt: at(1) },
      comment('a', 2),
    ]);
    expect(threads.map((t) => t.root.id)).toEqual(['a', 'b']);
  });

  it('nests replies under their thread oldest first, a reply to a reply included', () => {
    const threads = buildCommentThreads([
      comment('r2', 9, { parentId: 'root' }),
      comment('root', 1),
      comment('r1', 4, { parentId: 'root' }),
      comment('r1a', 6, { parentId: 'r1' }),
    ]);
    expect(threads).toHaveLength(1);
    expect(ids(threads[0].replies)).toEqual(['r1', 'r1a', 'r2']);
  });

  it('keeps a reply whose parent is gone as a thread of its own', () => {
    const threads = buildCommentThreads([comment('a', 1), comment('orphan', 3, { parentId: 'deleted' })]);
    expect(threads.map((t) => t.root.id)).toEqual(['a', 'orphan']);
  });

  it('keeps the feed order for comments written in the same instant', () => {
    const threads = buildCommentThreads([comment('x', 1), comment('y', 1), comment('z', 1)]);
    expect(threads.map((t) => t.root.id)).toEqual(['x', 'y', 'z']);
  });

  it('does not lose comments whose parents loop', () => {
    const threads = buildCommentThreads([comment('p', 1, { parentId: 'q' }), comment('q', 2, { parentId: 'p' })]);
    const all = threads.flatMap((t) => [t.root, ...t.replies]);
    expect(ids(all).sort()).toEqual(['p', 'q']);
  });
});

describe('latestRepliers', () => {
  it('lists each replier once, newest first, at most three', () => {
    const replies = [
      comment('1', 1, { actor: 'Ada' }),
      comment('2', 2, { actor: 'Grace' }),
      comment('3', 3, { actor: 'Ada' }),
      comment('4', 4, { actor: 'Alan' }),
      comment('5', 5, { actor: 'Edsger' }),
    ];
    expect(latestRepliers(replies).map((r) => r.actor)).toEqual(['Edsger', 'Alan', 'Ada']);
  });
});
