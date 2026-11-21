/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Button, cn } from '@object-ui/components';
import { Loader2, MessageSquare, X } from 'lucide-react';
import { useDetailTranslation } from '../useDetailTranslation';
import { CommentComposer } from './CommentComposer';
import { CommentHoverActions } from './CommentHoverActions';
import { CommentThread } from './CommentThread';
import { useRecordComments } from './useRecordComments';

export interface CommentsPanelProps {
  /** Closes the panel (its ✕, and Esc while focus is inside it). */
  onClose?: () => void;
  className?: string;
}

/**
 * The record's comment panel on the desktop (objectstack#36075): 「评论」 and ✕
 * at the top, the threads oldest first, the comment box docked at the foot.
 * It reads the record's discussion off the host's `DiscussionContext` and
 * fills the box its host gives it: where it sits (beside the record, over it,
 * over a drawer) and how wide is the host's to decide.
 */
export const CommentsPanel: React.FC<CommentsPanelProps> = ({ onClose, className }) => {
  const { t } = useDetailTranslation();
  const comments = useRecordComments();
  const { threads, loading, denied, failed, onRetry, onAddComment } = comments;
  const title = t('detail.comments');

  // The newest comment is at the foot: the list opens scrolled to it, and
  // follows a thread the reader (or anyone) adds.
  const listRef = React.useRef<HTMLDivElement>(null);
  const threadCount = threads.length;
  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [threadCount, loading]);

  let body: React.ReactNode;
  if (denied) {
    body = <PanelNote text={t('detail.commentsAccessDenied')} />;
  } else if (failed && threadCount === 0) {
    body = (
      <PanelNote text={t('detail.commentsLoadFailed')}>
        {onRetry && (
          <Button size="sm" variant="outline" className="mt-2 h-7" onClick={onRetry}>
            {t('detail.retryLoadFeed')}
          </Button>
        )}
      </PanelNote>
    );
  } else if (loading && threadCount === 0) {
    body = (
      <div className="flex flex-1 items-center justify-center py-10 text-muted-foreground" role="status" aria-label={t('detail.loading')}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  } else if (threadCount === 0) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-10 text-center" data-comments-empty="">
        <MessageSquare className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-foreground">{t('detail.noCommentsYet')}</p>
        {onAddComment && <p className="text-xs text-muted-foreground">{t('detail.commentsEmptyHint')}</p>}
      </div>
    );
  } else {
    body = (
      <div className="divide-y divide-border/60 px-4">
        {threads.map((thread) => (
          <CommentThread
            key={String(thread.root.id)}
            thread={thread}
            comments={comments}
            renderActions={(actions) => (
              <CommentHoverActions
                onReply={actions.onReply}
                onReact={actions.onReact}
                onEdit={actions.onEdit}
                onDelete={actions.onDelete}
              />
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <section
      aria-label={title}
      className={cn('flex h-full min-h-0 w-full flex-col bg-background', className)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onClose && !e.defaultPrevented) {
          e.stopPropagation();
          onClose();
        }
      }}
      data-comments-panel=""
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {onClose && (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('detail.closeComments')}
            title={t('detail.closeComments')}
            onClick={onClose}
            data-comments-panel-close=""
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-comments-list="">
        {body}
      </div>
      {onAddComment && !denied && (
        <div className="shrink-0 border-t border-border p-3" data-comments-composer="">
          <CommentComposer
            onSubmit={onAddComment}
            mentionSuggestions={comments.mentionSuggestions}
            onMentionSuggestionsWanted={comments.onMentionSuggestionsWanted}
          />
        </div>
      )}
    </section>
  );
};

const PanelNote: React.FC<{ text: string; children?: React.ReactNode }> = ({ text, children }) => (
  <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
    <p>{text}</p>
    {children}
  </div>
);
