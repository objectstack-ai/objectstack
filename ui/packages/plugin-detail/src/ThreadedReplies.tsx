/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Button } from '@object-ui/components';
import { MessageSquare, ChevronDown, ChevronRight, Send } from 'lucide-react';
import type { FeedItem } from '@object-ui/types';
import { useDisplayLocale } from '@object-ui/i18n';
import { useDetailTranslation } from './useDetailTranslation';
import { CommentBody } from './CommentAuthorControls';

export interface ThreadedRepliesProps {
  /** Parent feed item (root comment) */
  parentItem: FeedItem;
  /** Reply feed items (children) */
  replies: FeedItem[];
  /** Called when a reply is submitted. A rejection means it was not written: the draft is kept. */
  onAddReply?: (parentId: string | number, text: string) => void | Promise<void>;
  /** Whether to show the reply input */
  showReplyInput?: boolean;
  /**
   * Stores a new text for a reply the viewer wrote (objectui#12268): a reply
   * is a comment too, and offers its author the same Edit as a root comment,
   * on a reply whose `authoredByViewer` the host set. A rejection keeps the draft.
   */
  onEditComment?: (itemId: string | number, text: string) => void | Promise<void>;
  /** Deletes a reply the viewer wrote, on the same replies; the host confirms first. */
  onDeleteComment?: (itemId: string | number) => void | Promise<void>;
  className?: string;
}

function formatTimestamp(
  timestamp: string,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return t('detail.justNow');
    if (diffMins < 60) return t('detail.minutesAgo', { count: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t('detail.hoursAgo', { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return t('detail.daysAgo', { count: diffDays });
    // The tag is DECLARED (objectui#9786): a bare call formats the past-a-week
    // date in the machine's locale, which is neither channel.
    return date.toLocaleDateString(locale);
  } catch {
    return timestamp;
  }
}

/**
 * ThreadedReplies — Displays a collapsible thread of replies under a parent comment.
 * Supports adding new replies and showing reply count.
 */
export const ThreadedReplies: React.FC<ThreadedRepliesProps> = ({
  parentItem,
  replies,
  onAddReply,
  showReplyInput = true,
  onEditComment,
  onDeleteComment,
  className,
}) => {
  const { t } = useDetailTranslation();
  // The BCP-47 tag the absolute-date tail formats with (objectui#9786).
  const displayLocale = useDisplayLocale();
  const [expanded, setExpanded] = React.useState(false);
  const [replyText, setReplyText] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmitReply = React.useCallback(async () => {
    const text = replyText.trim();
    if (!text || !onAddReply) return;
    setIsSubmitting(true);
    try {
      await onAddReply(parentItem.id, text);
      setReplyText('');
    } catch {
      // A rejection means the reply was NOT written (objectui#10899): keep the
      // draft; the host reports why.
    } finally {
      setIsSubmitting(false);
    }
  }, [replyText, onAddReply, parentItem.id]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmitReply();
      }
    },
    [handleSubmitReply],
  );

  if (replies.length === 0 && !showReplyInput) return null;

  return (
    <div className={cn('ml-10 mt-1', className)}>
      {/* Toggle */}
      {replies.length > 0 && (
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <MessageSquare className="h-3 w-3" />
          {/* One count family (objectui#11445) — no `=== 1` switch here. */}
          <span>{t('detail.replyCount', { count: replies.length })}</span>
        </button>
      )}

      {/* Replies list */}
      {expanded && (
        <div className="space-y-2 border-l-2 border-border pl-3">
          {replies.map((reply) => (
            <div key={reply.id} className="flex gap-2">
              <div className="shrink-0">
                {reply.actorAvatarUrl ? (
                  <img
                    src={reply.actorAvatarUrl}
                    alt={reply.actor}
                    className="h-6 w-6 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                    {reply.actor.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{reply.actor}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatTimestamp(reply.createdAt, t, displayLocale)}
                  </span>
                  {/* A reply edited by its author reads as edited, as a root
                      comment does (objectui#12268). */}
                  {reply.edited && (
                    <span className="text-[10px] text-muted-foreground italic">{t('detail.edited')}</span>
                  )}
                </div>
                <CommentBody
                  item={reply}
                  onEditComment={onEditComment}
                  onDeleteComment={onDeleteComment}
                  bodyClassName="text-xs whitespace-pre-wrap break-words"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reply input */}
      {showReplyInput && onAddReply && (
        <div className="flex gap-1.5 mt-1.5">
          <input
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder={t('detail.replyPlaceholder')}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSubmitting}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={handleSubmitReply}
            disabled={!replyText.trim() || isSubmitting}
            aria-label="Send reply"
          >
            <Send className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
};
