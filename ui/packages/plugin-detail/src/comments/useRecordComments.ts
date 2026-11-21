/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { useDiscussionContext, type DiscussionMentionSuggestion } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { buildCommentThreads, type CommentThreadData } from './commentThreads';

/**
 * A record's discussion as the comment surfaces draw it (objectstack#36075):
 * the desktop comment panel, and the phone's comment page, read this and
 * nothing else.
 */
export interface RecordComments {
  /** The threads, oldest first; each thread's replies oldest first. */
  threads: CommentThreadData[];
  /**
   * The number the comments icon shows: the top-level comments. `null` while
   * the first read is in flight, or when it was refused or failed — an
   * unknown count is not zero.
   */
  count: number | null;
  loading: boolean;
  /** The comment read was refused (the member may not read the discussion). */
  denied: boolean;
  /** The comment read failed (5xx, network); `onRetry` reads it again. */
  failed: boolean;
  onRetry?: () => void;
  onAddComment?: (text: string) => void | Promise<void>;
  onAddReply?: (parentId: string | number, text: string) => void | Promise<void>;
  onToggleReaction?: (itemId: string | number, emoji: string) => void | Promise<void>;
  onEditComment?: (itemId: string | number, text: string) => void | Promise<void>;
  onDeleteComment?: (itemId: string | number) => void | Promise<void>;
  mentionSuggestions?: DiscussionMentionSuggestion[];
  onMentionSuggestionsWanted?: () => void;
}

const NO_ITEMS: FeedItem[] = [];

/**
 * The record's discussion off the host's `DiscussionContext`: the same rows
 * and the same writes the host hands every feed block, each write offered
 * exactly where the host offers it. Outside a provider it is an empty,
 * read-only discussion.
 */
export function useRecordComments(): RecordComments {
  const discussion = useDiscussionContext();
  const items = (discussion?.items as FeedItem[] | undefined) ?? NO_ITEMS;
  const threads = React.useMemo(() => buildCommentThreads(items), [items]);
  const loading = !!discussion?.loading;
  const denied = !!discussion?.commentsDenied;
  const failed = !!discussion?.commentsFailed;
  const onAddComment = discussion?.onAddComment;
  return {
    threads,
    count: !discussion || denied || failed || (loading && threads.length === 0) ? null : threads.length,
    loading,
    denied,
    failed,
    onRetry: failed ? discussion?.onRetryFeed : undefined,
    onAddComment: onAddComment ? (text: string) => onAddComment(text) : undefined,
    onAddReply: discussion?.onAddReply as RecordComments['onAddReply'],
    onToggleReaction: discussion?.onToggleReaction as RecordComments['onToggleReaction'],
    onEditComment: discussion?.onEditComment,
    onDeleteComment: discussion?.onDeleteComment,
    mentionSuggestions: discussion?.mentionSuggestions,
    onMentionSuggestionsWanted: discussion?.onMentionSuggestionsWanted,
  };
}
