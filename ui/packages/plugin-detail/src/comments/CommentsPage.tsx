/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Button, cn } from '@object-ui/components';
import { ChevronLeft, Loader2, MessageSquare } from 'lucide-react';
import { useDetailTranslation } from '../useDetailTranslation';
import { CommentActionSheet } from './CommentActionSheet';
import { CommentComposer } from './CommentComposer';
import { CommentsFilterMenu } from './CommentsFilterMenu';
import { CommentThread, type CommentItemActions } from './CommentThread';
import { DEFAULT_COMMENT_THREAD_FILTER, filterCommentThreads, type CommentThreadFilter } from './commentThreads';
import { useCommentPress } from './useCommentPress';
import { useRecordComments } from './useRecordComments';

export interface CommentsPageProps {
  /** The thread the page shows, by its top-level comment's id; `null`: the list. */
  threadId: string | null;
  /** A thread in the list was opened: the host shows `threadId` (it pushes a history entry). */
  onOpenThread: (rootId: string) => void;
  /** 「‹」: from a thread back to the list, from the list back to the record. */
  onBack: () => void;
  /** The list's 「‹」 names where it returns: the record. */
  backLabel: string;
  /**
   * The reader first held a comment: the host may now ask what the comment's
   * actions take (`updatesOthers`), and not before (objectstack#28470).
   */
  onEngage?: () => void;
  className?: string;
}

/**
 * The on-screen keyboard while the page is up: the visible area's top and
 * height (`visualViewport`), so the page stands on the keyboard with its
 * comment box in view. `null` with no keyboard (or no `visualViewport`):
 * `100dvh` and the layout viewport do not shrink for it on iOS Safari, nor on
 * Chrome for Android by default.
 */
function useVisibleViewport(): { top: number; height: number } | null {
  const [box, setBox] = React.useState<{ top: number; height: number } | null>(null);
  React.useEffect(() => {
    const viewport = typeof window === 'undefined' ? null : window.visualViewport;
    if (!viewport) return undefined;
    const read = () => {
      const covered = Math.round(window.innerHeight - viewport.height - viewport.offsetTop);
      // Below this the gap is the browser's own chrome moving, not a keyboard.
      setBox(covered < 80 ? null : { top: Math.round(viewport.offsetTop), height: Math.round(viewport.height) });
    };
    read();
    viewport.addEventListener('resize', read);
    viewport.addEventListener('scroll', read);
    return () => {
      viewport.removeEventListener('resize', read);
      viewport.removeEventListener('scroll', read);
    };
  }, []);
  return box;
}

const HEADER_BUTTON =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The record's comments on a phone (objectstack#36076): a page over the
 * record, two levels deep. The list shows each thread's top-level comment and
 * 「N 条回复」; a tap opens the thread, its comment first and the replies under
 * it. The comment box stays docked at the foot of the screen, above the
 * keyboard while it is up: in the list it writes a new comment, in a thread a
 * reply. A long press on a comment raises its actions from the bottom.
 *
 * The discussion, the writes and every gate are the host's
 * `DiscussionContext`, read through `useRecordComments`, the same as the
 * desktop panel's; only how the threads are laid out and how a comment's
 * actions are reached differ.
 */
export const CommentsPage: React.FC<CommentsPageProps> = ({
  threadId,
  onOpenThread,
  onBack,
  backLabel,
  onEngage,
  className,
}) => {
  const { t } = useDetailTranslation();
  const comments = useRecordComments();
  const { threads, loading, denied, failed, onRetry, onAddComment, onAddReply, resolvable } = comments;
  const [filter, setFilter] = React.useState<CommentThreadFilter>(DEFAULT_COMMENT_THREAD_FILTER);
  const shown = React.useMemo(
    () => (resolvable ? filterCommentThreads(threads, filter) : threads),
    [resolvable, threads, filter],
  );
  const thread = threadId == null ? undefined : threads.find((th) => String(th.root.id) === threadId);
  // A thread that is not (or no longer) here — deleted, or a stale link — shows the list.
  const inThread = !!thread;

  const [sheet, setSheet] = React.useState<CommentItemActions | null>(null);
  const engage = React.useCallback(
    (actions: CommentItemActions) => {
      onEngage?.();
      // A comment with nothing to do on it (a read-only discussion) raises nothing.
      if (actions.onReact || actions.onResolve || actions.onEdit || actions.onDelete) setSheet(actions);
    },
    [onEngage],
  );
  const listPress = useCommentPress({
    onLongPress: engage,
    onTap: (actions) => onOpenThread(String(actions.item.id)),
  });
  const threadPress = useCommentPress({ onLongPress: engage });
  // Moving between the list and a thread closes a sheet left open (adjusted while rendering).
  const [sheetThread, setSheetThread] = React.useState(threadId);
  if (sheetThread !== threadId) {
    setSheetThread(threadId);
    setSheet(null);
  }

  // 「回复」 inside the thread puts the caret in the docked box.
  const [composerFocus, setComposerFocus] = React.useState(0);

  // The newest comment is at the foot of the list: it opens scrolled there and
  // follows a thread that is added. A thread opens at its comment and follows
  // a reply that is added.
  const listRef = React.useRef<HTMLDivElement>(null);
  const threadRef = React.useRef<HTMLDivElement>(null);
  const threadCount = threads.length;
  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [threadCount, loading]);
  const replyCount = thread?.replies.length ?? 0;
  const seenReplies = React.useRef<{ id: string | null; count: number }>({ id: null, count: 0 });
  React.useLayoutEffect(() => {
    const el = threadRef.current;
    const seen = seenReplies.current;
    if (el && seen.id === threadId && replyCount > seen.count) el.scrollTop = el.scrollHeight;
    else if (el && seen.id !== threadId) el.scrollTop = 0;
    seenReplies.current = { id: threadId, count: replyCount };
  }, [threadId, replyCount]);

  const backRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, [inThread]);

  const viewport = useVisibleViewport();

  let listBody: React.ReactNode;
  if (denied) {
    listBody = <PageNote kind="denied" text={t('detail.commentsAccessDenied')} />;
  } else if (failed && threadCount === 0) {
    listBody = (
      <PageNote kind="failed" text={t('detail.commentsLoadFailed')}>
        {onRetry && (
          <Button size="sm" variant="outline" className="mt-3 h-11" onClick={onRetry}>
            {t('detail.retryLoadFeed')}
          </Button>
        )}
      </PageNote>
    );
  } else if (loading && threadCount === 0) {
    listBody = (
      <div className="flex flex-1 items-center justify-center py-10 text-muted-foreground" role="status" aria-label={t('detail.loading')}>
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  } else if (threadCount === 0) {
    listBody = (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-10 text-center" data-comments-empty="">
        <MessageSquare className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-base text-foreground">{t('detail.noCommentsYet')}</p>
        {onAddComment && <p className="text-sm text-muted-foreground">{t('detail.commentsEmptyHint')}</p>}
      </div>
    );
  } else if (shown.length === 0) {
    listBody = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center" data-comments-empty="filtered">
        <p className="text-sm text-muted-foreground">
          {filter.onlyMine ? t('detail.noCommentsInvolvingMe') : t('detail.noUnresolvedComments')}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-11"
          onClick={() => setFilter({ showResolved: true, onlyMine: false })}
          data-comments-show-all=""
        >
          {t('detail.showAllComments')}
        </Button>
      </div>
    );
  } else {
    listBody = (
      <div className="divide-y divide-border/60 px-4">
        {shown.map((th) => (
          <CommentThread
            key={String(th.root.id)}
            thread={th}
            comments={comments}
            mode="summary"
            onOpen={() => onOpenThread(String(th.root.id))}
            itemInteraction={listPress.bind}
          />
        ))}
      </div>
    );
  }

  const title = inThread ? t('detail.commentThread') : t('detail.comments');
  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={cn('fixed inset-x-0 top-0 z-40 flex h-dvh flex-col bg-background', className)}
      // Positional only: the keyboard's top edge is known at run time alone.
      style={viewport ? { top: viewport.top, height: viewport.height } : undefined}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.stopPropagation();
        onBack();
      }}
      data-comments-page={inThread ? 'thread' : 'list'}
      data-keyboard-up={viewport ? 'true' : undefined}
      data-owns-escape=""
    >
      <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border px-1 pt-[env(safe-area-inset-top)]">
        <button
          ref={backRef}
          type="button"
          className={cn(HEADER_BUTTON, 'justify-start gap-0.5 justify-self-start pr-2 text-sm font-medium')}
          onClick={onBack}
          title={t('detail.goBack')}
          data-comments-page-back=""
        >
          <ChevronLeft className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="truncate">{inThread ? t('detail.comments') : backLabel}</span>
        </button>
        <h2 className="truncate text-base font-medium text-foreground">{title}</h2>
        <div className="flex justify-self-end">
          {!inThread && resolvable && !denied && (
            <CommentsFilterMenu filter={filter} onFilterChange={setFilter} triggerClassName="h-11 w-11" />
          )}
        </div>
      </header>
      <div
        ref={listRef}
        className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain', inThread && 'hidden')}
        data-comments-list=""
      >
        {listBody}
      </div>
      {thread && (
        <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" data-comments-thread="">
          <CommentThread
            thread={thread}
            comments={comments}
            mode="page"
            onOpen={() => setComposerFocus((n) => n + 1)}
            itemInteraction={threadPress.bind}
          />
        </div>
      )}
      {/* The list's box and a thread's are two boxes: each keeps its own
          draft, and a draft written in the list is never posted as a reply. */}
      {!denied && onAddComment && (
        <ComposerDock hidden={inThread} keyboardUp={!!viewport} kind="comment">
          <CommentComposer
            layout="phone"
            placeholder={t('detail.writeComment')}
            mentionSuggestions={comments.mentionSuggestions}
            onMentionSuggestionsWanted={comments.onMentionSuggestionsWanted}
            onSubmit={onAddComment}
          />
        </ComposerDock>
      )}
      {!denied && onAddReply && thread && (
        <ComposerDock keyboardUp={!!viewport} kind="reply">
          <CommentComposer
            key={String(thread.root.id)}
            layout="phone"
            focusSignal={composerFocus}
            placeholder={t('detail.replyPlaceholder')}
            mentionSuggestions={comments.mentionSuggestions}
            onMentionSuggestionsWanted={comments.onMentionSuggestionsWanted}
            onSubmit={(text) => onAddReply(thread.root.id, text)}
          />
        </ComposerDock>
      )}
      <CommentActionSheet actions={sheet} onClose={() => setSheet(null)} />
    </section>
  );
};

/** The comment box's place at the foot of the page, over the safe area or on the keyboard. */
const ComposerDock: React.FC<{ hidden?: boolean; keyboardUp: boolean; kind: 'comment' | 'reply'; children: React.ReactNode }> = ({
  hidden,
  keyboardUp,
  kind,
  children,
}) => (
  <div
    className={cn(
      'shrink-0 border-t border-border bg-background px-3 pt-2',
      keyboardUp ? 'pb-2' : 'pb-[max(env(safe-area-inset-bottom),0.5rem)]',
      hidden && 'hidden',
    )}
    data-comments-composer={kind}
  >
    {children}
  </div>
);

const PageNote: React.FC<{ kind: 'denied' | 'failed'; text: string; children?: React.ReactNode }> = ({ kind, text, children }) => (
  <div
    className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground"
    data-comments-note={kind}
  >
    <p>{text}</p>
    {children}
  </div>
);
