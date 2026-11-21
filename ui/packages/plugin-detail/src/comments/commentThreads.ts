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

/**
 * Whether the thread can be resolved and reopened (objectstack#36071): its
 * first comment is a real top-level comment (not a reply whose parent is gone,
 * which the server refuses to resolve) and the deployment stores resolution
 * (the host set `resolved`).
 */
export function threadResolvable(thread: CommentThreadData): boolean {
  return thread.root.parentId == null && typeof thread.root.resolved === 'boolean';
}

/** Whether the thread is resolved: its top-level comment's `resolved`. */
export function threadResolved(thread: CommentThreadData): boolean {
  return threadResolvable(thread) && thread.root.resolved === true;
}

/**
 * 「只看我参与的」 (objectstack#36075 item 7): the viewer started the thread,
 * replied in it, or is mentioned in it — the rule #36071's
 * `threadsInvolvingUser` states for the server, read here off the host's
 * viewer-relative marks (`authoredByViewer`, `mentionsViewer`).
 */
export function threadInvolvesViewer(thread: CommentThreadData): boolean {
  return [thread.root, ...thread.replies].some(
    (item) => item.authoredByViewer === true || item.mentionsViewer === true,
  );
}

/** What the comment panel's filter menu holds (objectstack#36075 item 7). */
export interface CommentThreadFilter {
  /** 「显示已解决」: resolved threads are shown too. Off by default. */
  showResolved: boolean;
  /** 「只看我参与的」: only the threads the viewer is in. */
  onlyMine: boolean;
}

export const DEFAULT_COMMENT_THREAD_FILTER: CommentThreadFilter = { showResolved: false, onlyMine: false };

/** The threads the filter keeps, in their order. */
export function filterCommentThreads(
  threads: readonly CommentThreadData[],
  filter: CommentThreadFilter,
): CommentThreadData[] {
  return threads.filter(
    (thread) => (filter.showResolved || !threadResolved(thread)) && (!filter.onlyMine || threadInvolvesViewer(thread)),
  );
}

/**
 * The comments icon's number (objectstack#36075 item 8): the threads not
 * resolved. Where the deployment stores no resolution, every thread.
 */
export function unresolvedThreadCount(threads: readonly CommentThreadData[]): number {
  return threads.filter((thread) => !threadResolved(thread)).length;
}
