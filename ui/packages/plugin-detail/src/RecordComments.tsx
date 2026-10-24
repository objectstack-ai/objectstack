/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Button, Card, CardHeader, CardTitle, CardContent } from '@object-ui/components';
import { MessageSquare, Send, Pin, Search, X } from 'lucide-react';
import type { CommentEntry } from '@object-ui/types';
import { useDisplayLocale } from '@object-ui/i18n';
import { useDetailTranslation } from './useDetailTranslation';

export interface RecordCommentsProps {
  comments: CommentEntry[];
  /** A rejection means the comment was not written: the composer keeps the draft. */
  onAddComment?: (text: string) => void | Promise<void>;
  /** Callback to toggle pin/star on a comment */
  onTogglePin?: (commentId: string | number) => void;
  /** Enable search input for filtering comments */
  searchable?: boolean;
  className?: string;
}

type CommentsTranslate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Format a timestamp string into a human-readable relative time or date string.
 *
 * objectui#7163 — the four relative-time branches were hardcoded English, so a
 * zh session read a translated comment card with an English `5m ago` inside it.
 * They now resolve from the packs through the same four keys the siblings in
 * this package already use (`RecordActivityTimeline`, `RecordMetaFooter`,
 * `ThreadedReplies`, and `ActivityTimeline` since objectui#7162) — reused, not
 * forked: each key's `en` value is byte-identical to the literal it replaces,
 * so this is a lookup swap with no copy change and no new key in any pack.
 *
 * `t` is threaded in as a parameter rather than the helper being made a hook:
 * it is called from inside a `.map()` over the comment list.
 */
function formatTimestamp(timestamp: string, t: CommentsTranslate, locale: string): string {
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
    // Past a week this is a DATE, not a relative phrase: `toLocaleDateString`
    // already localizes it, so there is no literal here to key. The tag is
    // DECLARED (objectui#9786) — a bare call reads the machine's locale.
    return date.toLocaleDateString(locale);
  } catch {
    return timestamp;
  }
}

export const RecordComments: React.FC<RecordCommentsProps> = ({
  comments,
  onAddComment,
  onTogglePin,
  searchable = false,
  className,
}) => {
  const { t } = useDetailTranslation();
  // The BCP-47 tag the absolute-date tail formats with; threaded down for the
  // same reason `t` is — the helper runs inside a `.map()` (objectui#9786).
  const displayLocale = useDisplayLocale();
  const [newComment, setNewComment] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');

  const handleSubmit = React.useCallback(async () => {
    const text = newComment.trim();
    if (!text || !onAddComment) return;

    setIsSubmitting(true);
    try {
      await onAddComment(text);
      setNewComment('');
    } catch {
      // A rejection means the comment was NOT written (objectui#10899): keep
      // the draft; the host reports why.
    } finally {
      setIsSubmitting(false);
    }
  }, [newComment, onAddComment]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  /** Sort pinned comments first, then by date */
  const sortedComments = React.useMemo(() => {
    const filtered = searchQuery.trim()
      ? comments.filter(c => {
          const q = searchQuery.trim().toLowerCase();
          return c.text.toLowerCase().includes(q) || c.author.toLowerCase().includes(q);
        })
      : comments;

    return [...filtered].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });
  }, [comments, searchQuery]);

  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4" />
          {t('detail.comments')}
          <span className="text-sm font-normal text-muted-foreground">
            ({comments.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search Input */}
        {searchable && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                className="w-full rounded-md border border-input bg-background pl-8 pr-8 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={t('detail.searchComments')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t('detail.searchComments')}
              />
              {searchQuery && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchQuery('')}
                  aria-label={t('detail.clearSearch')}
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Comment Input */}
        {onAddComment && (
          <div className="flex gap-2">
            <textarea
              className="flex-1 min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              placeholder={t('detail.addCommentPlaceholder')}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSubmitting}
            />
            <Button
              size="icon"
              variant="default"
              onClick={handleSubmit}
              disabled={!newComment.trim() || isSubmitting}
              className="shrink-0 self-end"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Comment List */}
        {sortedComments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {searchQuery.trim() ? t('detail.noMatchingComments') : t('detail.noCommentsYet')}
          </p>
        ) : (
          <div className="space-y-3">
            {sortedComments.map((comment) => (
              <div key={comment.id} className={cn('flex gap-3', comment.pinned && 'bg-muted/40 rounded-md p-2 -mx-2')}>
                {/* Avatar */}
                <div className="shrink-0">
                  {comment.avatarUrl ? (
                    <img
                      src={comment.avatarUrl}
                      alt={comment.author}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                      {comment.author.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium truncate">{comment.author}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(comment.createdAt, t, displayLocale)}
                    </span>
                    {comment.pinned && (
                      <span className="text-xs text-amber-600 flex items-center gap-0.5">
                        <Pin className="h-3 w-3" />
                        {t('detail.pinned')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words">{comment.text}</p>
                  {/* Pin action */}
                  {onTogglePin && (
                    <button
                      type="button"
                      className="mt-1 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                      onClick={() => onTogglePin(comment.id)}
                      aria-label={comment.pinned ? t('detail.unpin') : t('detail.pin')}
                    >
                      <Pin className="h-3 w-3" />
                      {comment.pinned ? t('detail.unpin') : t('detail.pin')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
