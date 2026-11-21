/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  cn,
} from '@object-ui/components';
import { ListFilter, Loader2, MessageSquare, X } from 'lucide-react';
import { useDetailTranslation } from '../useDetailTranslation';
import { CommentComposer } from './CommentComposer';
import { CommentHoverActions } from './CommentHoverActions';
import { CommentThread } from './CommentThread';
import { DEFAULT_COMMENT_THREAD_FILTER, filterCommentThreads, type CommentThreadFilter } from './commentThreads';
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
  const { threads, loading, denied, failed, onRetry, onAddComment, resolvable } = comments;
  const title = t('detail.comments');
  // The filter menu (objectstack#36075 item 7): resolved threads hidden by
  // default, 「只看我参与的」 off. Held while the panel is open, never stored.
  const [filter, setFilter] = React.useState<CommentThreadFilter>(DEFAULT_COMMENT_THREAD_FILTER);
  // Where the deployment stores no resolution there is nothing to hide: the
  // menu is not offered and every thread shows.
  const shown = React.useMemo(
    () => (resolvable ? filterCommentThreads(threads, filter) : threads),
    [resolvable, threads, filter],
  );
  const filtering = resolvable && (filter.onlyMine || !filter.showResolved);

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
    body = <PanelNote kind="denied" text={t('detail.commentsAccessDenied')} />;
  } else if (failed && threadCount === 0) {
    body = (
      <PanelNote kind="failed" text={t('detail.commentsLoadFailed')}>
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
  } else if (shown.length === 0) {
    // Every thread is filtered out: say why, and offer the way back.
    body = (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center"
        data-comments-empty="filtered"
      >
        <p className="text-sm text-muted-foreground">
          {filter.onlyMine ? t('detail.noCommentsInvolvingMe') : t('detail.noUnresolvedComments')}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => setFilter({ showResolved: true, onlyMine: false })}
          data-comments-show-all=""
        >
          {t('detail.showAllComments')}
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="divide-y divide-border/60 px-4">
        {shown.map((thread) => (
          <CommentThread
            key={String(thread.root.id)}
            thread={thread}
            comments={comments}
            renderActions={(actions) => (
              <CommentHoverActions
                onReply={actions.onReply}
                onReact={actions.onReact}
                onResolve={actions.onResolve}
                resolved={actions.resolved}
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
        if (e.key !== 'Escape' || !onClose) return;
        // A layer the panel opened (the More menu, the emoji picker) is
        // portaled out of it and closes itself on its own Esc. A field that
        // takes the key inside the panel (the mention list, the inline
        // editor) stops it before it gets here. `defaultPrevented` says
        // nothing: a drawer round the panel marks the key to hold itself open.
        if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
        e.stopPropagation();
        onClose();
      }}
      data-comments-panel=""
      // An Esc pressed in here is the panel's: a pane round it leaves it be.
      data-owns-escape=""
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <div className="flex items-center gap-0.5">
        {resolvable && !denied && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  filter.onlyMine && 'text-primary hover:text-primary',
                )}
                aria-label={t('detail.filterComments')}
                title={t('detail.filterComments')}
                data-comments-filter=""
                data-comments-filtering={filtering ? 'true' : 'false'}
              >
                <ListFilter className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuCheckboxItem
                checked={filter.showResolved}
                onCheckedChange={(checked) => setFilter((f) => ({ ...f, showResolved: checked === true }))}
                data-comments-filter-option="show-resolved"
              >
                {t('detail.showResolvedComments')}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={filter.onlyMine}
                onCheckedChange={(checked) => setFilter((f) => ({ ...f, onlyMine: checked === true }))}
                data-comments-filter-option="only-mine"
              >
                {t('detail.commentsInvolvingMe')}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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
        </div>
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

const PanelNote: React.FC<{ kind: 'denied' | 'failed'; text: string; children?: React.ReactNode }> = ({ kind, text, children }) => (
  <div
    className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground"
    data-comments-note={kind}
  >
    <p>{text}</p>
    {children}
  </div>
);
