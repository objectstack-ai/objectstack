/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import type { FeedItem } from '@object-ui/types';
import { useDetailTranslation } from '../useDetailTranslation';
import { CommentAvatar } from './CommentAvatar';
import { CommentComposer } from './CommentComposer';
import { CommentItem } from './CommentItem';
import { latestRepliers, type CommentThreadData } from './commentThreads';
import type { RecordCommentsData } from './useRecordComments';

/**
 * What a comment's action row is handed, per comment: the surface decides how
 * they are reached (`CommentHoverActions` on the desktop, a long press on the
 * phone) and draws them through `renderActions`.
 */
export interface CommentItemActions {
  item: FeedItem;
  /** The comment is the thread's top-level one. */
  isRoot: boolean;
  onReply?: () => void;
  onReact?: (emoji: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export interface CommentThreadProps {
  thread: CommentThreadData;
  /** The writes, as `useRecordComments` hands them. */
  comments: Pick<
    RecordCommentsData,
    'onAddReply' | 'onToggleReaction' | 'onEditComment' | 'onDeleteComment' | 'mentionSuggestions' | 'onMentionSuggestionsWanted'
  >;
  /**
   * `expand`: the replies open in place, under the comment, with the reply
   * box after them (the desktop panel). `summary`: the thread stays one
   * comment and 「N 条回复」, and a press on it calls `onOpen` (the phone's
   * list, which opens the thread on its own page).
   */
  mode?: 'expand' | 'summary';
  onOpen?: () => void;
  /** Draws a comment's actions; absent, a comment has none on screen. */
  renderActions?: (actions: CommentItemActions) => React.ReactNode;
  className?: string;
}

/** Whether the viewer wrote this comment: the host's verdict, never re-derived here. */
function ownComment(item: FeedItem): boolean {
  return item.type === 'comment' && item.authoredByViewer === true;
}

/**
 * A thread (objectstack#36075): its top-level comment, then either 「N 条回复」
 * with the faces of the latest repliers (collapsed) or the replies and the
 * reply box (expanded). 「回复」 on any comment of the thread opens it and puts
 * the caret in the reply box; a reply always answers the thread's first
 * comment.
 */
export const CommentThread: React.FC<CommentThreadProps> = ({
  thread,
  comments,
  mode = 'expand',
  onOpen,
  renderActions,
  className,
}) => {
  const { t } = useDetailTranslation();
  const { root, replies } = thread;
  const [expanded, setExpanded] = React.useState(false);
  // Bumped by each 「回复」: the reply box takes the caret, so a second press
  // on an open thread still lands it there.
  const [replyFocus, setReplyFocus] = React.useState(0);
  const [editingId, setEditingId] = React.useState<string | number | null>(null);
  const { onAddReply, onToggleReaction, onEditComment, onDeleteComment } = comments;

  const openReply = React.useCallback(() => {
    if (mode === 'summary') {
      onOpen?.();
      return;
    }
    setExpanded(true);
    setReplyFocus((n) => n + 1);
  }, [mode, onOpen]);

  const actionsOf = (item: FeedItem, isRoot: boolean): CommentItemActions => ({
    item,
    isRoot,
    onReply: onAddReply ? openReply : undefined,
    onReact: onToggleReaction ? (emoji: string) => void onToggleReaction(item.id, emoji) : undefined,
    onEdit: onEditComment && ownComment(item) ? () => setEditingId(item.id) : undefined,
    onDelete: onDeleteComment && ownComment(item) ? () => void onDeleteComment(item.id) : undefined,
  });

  const itemOf = (item: FeedItem, isRoot: boolean, footer?: React.ReactNode) => (
    <CommentItem
      key={String(item.id)}
      item={item}
      actions={renderActions?.(actionsOf(item, isRoot))}
      editing={editingId === item.id}
      onSaveEdit={
        onEditComment
          ? async (text) => {
              await onEditComment(item.id, text);
              setEditingId(null);
            }
          : undefined
      }
      onCancelEdit={() => setEditingId(null)}
      onToggleReaction={onToggleReaction ? (emoji) => void onToggleReaction(item.id, emoji) : undefined}
      footer={footer}
    />
  );

  const open = mode === 'expand' && expanded;
  const summary = replies.length > 0 && !open && (
    <button
      type="button"
      className="mt-1.5 inline-flex h-6 items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-expanded={mode === 'expand' ? false : undefined}
      onClick={() => (mode === 'summary' ? onOpen?.() : setExpanded(true))}
      data-comment-replies-summary=""
    >
      <span className="flex -space-x-1">
        {latestRepliers(replies).map((reply) => (
          <CommentAvatar key={String(reply.id)} item={reply} size="sm" className="ring-1 ring-background" />
        ))}
      </span>
      {t('detail.replyCount', { count: replies.length })}
    </button>
  );

  return (
    <div className={cn('py-3', className)} data-comment-thread="" data-comment-thread-open={open ? 'true' : 'false'}>
      {itemOf(root, true, summary || undefined)}
      {open && (
        <div className="ml-2.5 mt-2 space-y-3 border-l-2 border-border pl-4" data-comment-replies="">
          {replies.map((reply) => itemOf(reply, false))}
          {onAddReply && (
            <CommentComposer
              focusSignal={replyFocus}
              placeholder={t('detail.replyPlaceholder')}
              mentionSuggestions={comments.mentionSuggestions}
              onMentionSuggestionsWanted={comments.onMentionSuggestionsWanted}
              onSubmit={(text) => onAddReply(root.id, text)}
            />
          )}
          {replies.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded
              onClick={() => setExpanded(false)}
              data-comment-replies-collapse=""
            >
              {t('detail.collapseReplies')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
