/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { Check } from 'lucide-react';
import type { FeedItem } from '@object-ui/types';
import { useDetailTranslation } from '../useDetailTranslation';
import { CommentAuthorAvatar } from '../CommentAuthorAvatar';
import { CommentComposer } from './CommentComposer';
import { CommentItem } from './CommentItem';
import { latestRepliers, threadResolvable, threadResolved, type CommentThreadData } from './commentThreads';
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
  /**
   * Resolves the thread, or reopens it when it is resolved (`resolved`).
   * Offered on the thread's top-level comment only, where the deployment
   * stores resolution (objectstack#36071).
   */
  onResolve?: () => void;
  /** The thread is resolved: the resolve control reads as 「恢复」. */
  resolved?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

export interface RecordCommentThreadProps {
  thread: CommentThreadData;
  /** The writes, as `useRecordComments` hands them. */
  comments: Pick<
    RecordCommentsData,
    | 'onAddReply'
    | 'onToggleReaction'
    | 'onEditComment'
    | 'onDeleteComment'
    | 'onResolveComment'
    | 'moderates'
    | 'updatesOthers'
    | 'mentionSuggestions'
    | 'onMentionSuggestionsWanted'
  >;
  /**
   * `expand`: the replies open in place, under the comment, with the reply
   * box after them (the desktop panel). `summary`: the thread stays one
   * comment and 「N 条回复」, and a press on it calls `onOpen` (the phone's
   * list, which opens the thread on its own page). `page`: the thread is the
   * page, its comment first and every reply after it, oldest first; the page
   * docks its own reply box, so the thread draws none (the phone's thread).
   */
  mode?: 'expand' | 'summary' | 'page';
  /**
   * `summary`: opens the thread. `page`: 「回复」 was pressed; the host puts
   * the caret in its reply box.
   */
  onOpen?: () => void;
  /** Draws a comment's actions; absent, a comment has none on screen. */
  renderActions?: (actions: CommentItemActions) => React.ReactNode;
  /**
   * What a comment answers to besides its own controls: the phone's long
   * press and tap (`useCommentPress`). Spread on each comment's box.
   */
  itemInteraction?: (actions: CommentItemActions) => React.HTMLAttributes<HTMLDivElement>;
  /**
   * The comment whose actions the surface holds open, by id (the phone's long
   * press sheet). While it is one of this thread's, its current actions go to
   * `onHeldActions` each time what they offer changes, so a gate that opens
   * while the sheet is up (the host's answer to `updatesOthers`) adds its row.
   */
  heldId?: string | null;
  onHeldActions?: (actions: CommentItemActions) => void;
  className?: string;
}

/** The viewer wrote this comment (`authoredByViewer`, the host's verdict, never re-derived here). */
function ownComment(item: FeedItem): boolean {
  return item.type === 'comment' && item.authoredByViewer === true;
}

/**
 * Whether the viewer may edit this comment (objectstack#36075 item 6): their
 * own, or anyone's where the host says both that the viewer may moderate this
 * record's comments (the server admits a parent record editor) and that the
 * server admits their update of a row they did not write (the row floor).
 */
function editableComment(item: FeedItem, moderates: boolean | undefined, updatesOthers: boolean | undefined): boolean {
  return ownComment(item) || (item.type === 'comment' && moderates === true && updatesOthers === true);
}

/** Whether the viewer may delete this comment: their own, or anyone's where they moderate. */
function deletableComment(item: FeedItem, moderates: boolean | undefined): boolean {
  return ownComment(item) || (item.type === 'comment' && moderates === true);
}

/**
 * The resolver's name: the host's, else the entry for their id in a mention
 * list the composer already loaded, else none — the mark then says 「已解决」.
 */
function resolverName(
  root: FeedItem,
  suggestions: RecordCommentsData['mentionSuggestions'],
): string | undefined {
  if (root.resolvedByName) return root.resolvedByName;
  if (root.resolvedById == null) return undefined;
  return suggestions?.find((s) => s.id === root.resolvedById)?.label;
}

/**
 * A thread (objectstack#36075): its top-level comment, then either 「N 条回复」
 * with the faces of the latest repliers (collapsed) or the replies and the
 * reply box (expanded). 「回复」 on any comment of the thread opens it and puts
 * the caret in the reply box; a reply always answers the thread's first
 * comment.
 */
export const CommentThread: React.FC<RecordCommentThreadProps> = ({
  thread,
  comments,
  mode = 'expand',
  onOpen,
  renderActions,
  itemInteraction,
  heldId,
  onHeldActions,
  className,
}) => {
  const { t } = useDetailTranslation();
  const { root, replies } = thread;
  const [expanded, setExpanded] = React.useState(false);
  // Bumped by each 「回复」: the reply box takes the caret, so a second press
  // on an open thread still lands it there.
  const [replyFocus, setReplyFocus] = React.useState(0);
  const [editingId, setEditingId] = React.useState<string | number | null>(null);
  const { onAddReply, onToggleReaction, onEditComment, onDeleteComment, onResolveComment, moderates, updatesOthers } =
    comments;
  const resolvable = threadResolvable(thread);
  const resolved = threadResolved(thread);
  // The host names the resolver (a by-id read of the ids it could not name);
  // a mention list the composer already loaded is used too, never read for it.
  const resolvedBy = resolved ? resolverName(root, comments.mentionSuggestions) : undefined;

  const openReply = React.useCallback(() => {
    if (mode !== 'expand') {
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
    // ✓ writes the top-level row: on a thread the viewer started, or anyone's
    // where the server admits their update of a row they did not write.
    onResolve:
      isRoot && resolvable && onResolveComment && (ownComment(item) || updatesOthers === true)
        ? () => {
            // A refused write changed nothing, and the host has said so.
            void Promise.resolve(onResolveComment(item.id, !resolved)).catch(() => undefined);
          }
        : undefined,
    resolved: isRoot && resolved,
    onEdit: onEditComment && editableComment(item, moderates, updatesOthers) ? () => setEditingId(item.id) : undefined,
    onDelete: onDeleteComment && deletableComment(item, moderates) ? () => void onDeleteComment(item.id) : undefined,
  });

  // The held comment's actions, reported again whenever what they offer changes.
  const heldItem = heldId == null ? undefined : [root, ...replies].find((item) => String(item.id) === heldId);
  const held = heldItem ? actionsOf(heldItem, heldItem === root) : undefined;
  const heldOffer = held
    ? [!!held.onReact, !!held.onResolve, !!held.resolved, !!held.onEdit, !!held.onDelete].join()
    : null;
  const heldReport = React.useRef({ held, onHeldActions });
  React.useLayoutEffect(() => {
    heldReport.current = { held, onHeldActions };
  });
  React.useLayoutEffect(() => {
    const { held: current, onHeldActions: report } = heldReport.current;
    if (current) report?.(current);
  }, [heldItem, heldOffer]);

  const itemOf = (item: FeedItem, isRoot: boolean, footer?: React.ReactNode, itemClassName?: string) => {
    const actions = renderActions || itemInteraction ? actionsOf(item, isRoot) : undefined;
    return (
    <CommentItem
      key={String(item.id)}
      item={item}
      className={itemClassName}
      actions={actions && renderActions?.(actions)}
      interactionProps={actions && itemInteraction?.(actions)}
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
  };

  if (mode === 'page') {
    return (
      <div className={cn('py-3', className)} data-comment-thread="" data-comment-thread-page="">
        {resolved && (
          <p className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground" data-comment-resolved-mark="">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {resolvedBy ? t('detail.threadResolvedBy', { name: resolvedBy }) : t('detail.threadResolved')}
          </p>
        )}
        {itemOf(root, true)}
        {replies.length > 0 && (
          <div className="mt-4 space-y-4 border-t border-border/60 pt-4" data-comment-replies="">
            {replies.map((reply) => itemOf(reply, false))}
          </div>
        )}
      </div>
    );
  }

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
          <CommentAuthorAvatar
            key={String(reply.id)}
            name={reply.actor}
            avatarUrl={reply.actorAvatarUrl}
            className="size-4 ring-1 ring-background"
          />
        ))}
      </span>
      {t('detail.replyCount', { count: replies.length })}
    </button>
  );

  return (
    <div
      className={cn('py-3', className)}
      data-comment-thread=""
      data-comment-thread-open={open ? 'true' : 'false'}
      data-comment-thread-resolved={resolved ? 'true' : undefined}
    >
      {resolved && (
        <p className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground" data-comment-resolved-mark="">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          {resolvedBy ? t('detail.threadResolvedBy', { name: resolvedBy }) : t('detail.threadResolved')}
        </p>
      )}
      {itemOf(root, true, summary || undefined, resolved && !open ? 'opacity-70' : undefined)}
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
