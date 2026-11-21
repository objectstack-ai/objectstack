/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { FeedItem } from '@object-ui/types';

/**
 * One thread of a record's discussion (objectstack#36075): a top-level comment
 * and its replies, both oldest first.
 */
export interface CommentThreadData {
  root: FeedItem;
  replies: FeedItem[];
}

function createdAtOf(item: FeedItem): number {
  const at = Date.parse(item.createdAt);
  return Number.isNaN(at) ? 0 : at;
}

/**
 * A record's comments as threads, oldest first: every `comment` row of the
 * feed, the other rows (activity, field changes) left out.
 *
 * A reply nests under its parent only when the feed holds that parent. One
 * whose parent is not held (deleted — the server keeps the replies) is a
 * thread of its own, in its place, so deleting a comment never hides another
 * member's reply to it. Who may delete what is not decided here.
 */
export function buildCommentThreads(items: readonly FeedItem[]): CommentThreadData[] {
  const comments = items
    .filter((item) => item.type === 'comment')
    // A stable sort: rows written in the same millisecond keep the feed's order.
    .map((item, index) => ({ item, index }))
    .sort((a, b) => createdAtOf(a.item) - createdAtOf(b.item) || a.index - b.index)
    .map(({ item }) => item);
  const byId = new Map<string, FeedItem>(comments.map((item) => [String(item.id), item]));
  // The thread a comment belongs to: its topmost held ancestor. A reply to a
  // reply joins the same thread.
  const rootIdOf = (item: FeedItem): string => {
    let current = item;
    const seen = new Set<string>([String(item.id)]);
    while (current.parentId != null) {
      const parentKey = String(current.parentId);
      const parent = byId.get(parentKey);
      if (!parent) break;
      // Bad data that loops: the comment stands as its own thread.
      if (seen.has(parentKey)) return String(item.id);
      seen.add(parentKey);
      current = parent;
    }
    return String(current.id);
  };
  const threads: CommentThreadData[] = [];
  const byRoot = new Map<string, CommentThreadData>();
  for (const item of comments) {
    const rootId = rootIdOf(item);
    const thread = byRoot.get(rootId);
    if (thread) {
      if (thread.root !== item) thread.replies.push(item);
    } else if (rootId === String(item.id)) {
      const created: CommentThreadData = { root: item, replies: [] };
      threads.push(created);
      byRoot.set(rootId, created);
    } else {
      // A reply sorted ahead of its root (clock skew): its thread opens with
      // the root, so it waits there.
      const root = byId.get(rootId)!;
      const created: CommentThreadData = { root, replies: [item] };
      threads.push(created);
      byRoot.set(rootId, created);
    }
  }
  return threads;
}

/**
 * The people who replied last in a thread, newest first and each once: the
 * faces a collapsed thread shows beside 「N 条回复」.
 */
export function latestRepliers(replies: readonly FeedItem[], max = 3): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (let i = replies.length - 1; i >= 0 && out.length < max; i -= 1) {
    const reply = replies[i];
    const key = reply.actorId != null ? String(reply.actorId) : reply.actor;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reply);
  }
  return out;
}
