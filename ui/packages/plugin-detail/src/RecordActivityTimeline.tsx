/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, DataEmptyState } from '@object-ui/components';
import {
  Activity,
  Edit,
  PlusCircle,
  Trash2,
  MessageSquare,
  Calendar,
  CheckSquare,
  Zap,
  Mail,
  Phone,
  ChevronDown,
  Loader2,
  StickyNote,
  FileText,
  Share2,
  BadgeCheck,
  Lock,
} from 'lucide-react';
import type { FeedItem, FeedItemType, RecordActivityComponentProps, RecordSubscription } from '@object-ui/types';
import type { FeedFilterMode } from '@objectstack/spec/data';
import { FieldChangeItem } from './FieldChangeItem';
import { ReactionPicker } from './ReactionPicker';
import { ThreadedReplies } from './ThreadedReplies';
import { SubscriptionToggle } from './SubscriptionToggle';
import { RichTextCommentInput } from './RichTextCommentInput';
import { CommentAttachment, type Attachment } from './CommentAttachment';
import { CommentBody } from './CommentAuthorControls';
import { useDisplayLocale } from '@object-ui/i18n';
import { useDetailTranslation } from './useDetailTranslation';

/**
 * Which slice of the record feed the timeline shows.
 *
 * Re-exported from `@objectstack/spec/data`, not restated (objectui#3161,
 * objectstack#4115 ledger batch 7). It was a hand copy of the spec's four
 * members under the spec's own name — in a file that already imports
 * `FeedItemType` from the spec vocabulary two lines up, so the correct pattern
 * was sitting next to it. The copy happened to be in sync; the point is that
 * nothing made it stay so. `getFilterOptions` below renders one `<SelectItem>`
 * per member, so a member the spec adds is a filter the user cannot pick and a
 * member it retires is a dead menu entry — neither is reportable while the
 * union is written out here. (`normalizeFilterMode` already reads the spec enum
 * at RUNTIME; the type was the half still on a copy.)
 */
export type { FeedFilterMode };

export interface RecordActivityTimelineProps {
  /** Feed items to display */
  items: FeedItem[];
  /** Activity configuration from RecordActivityComponentProps */
  config?: RecordActivityComponentProps;
  /** Filter mode for the timeline */
  filterMode?: FeedFilterMode;
  /** Called when filter mode changes */
  onFilterChange?: (mode: FeedFilterMode) => void;
  /** Whether there are more items to load */
  hasMore?: boolean;
  /** Called when user wants to load more items */
  onLoadMore?: () => void | Promise<void>;
  /** Whether the feed is still being fetched. While true and nothing is on
   *  screen yet, the timeline shows a loading row instead of the empty state
   *  — "still fetching" is not "no activity" (objectui#3205). */
  loading?: boolean;
  /**
   * Called when a comment is submitted. A returned promise that REJECTS means
   * the comment was not written: the composer keeps the draft, and reporting
   * the failure is the host's job.
   */
  onAddComment?: (text: string, attachments?: Attachment[]) => void | Promise<void>;
  /** Called when a reply is submitted — a rejection keeps the reply draft, as above. */
  onAddReply?: (parentId: string | number, text: string) => void | Promise<void>;
  /** Called when user toggles a reaction */
  onToggleReaction?: (itemId: string | number, emoji: string) => void | Promise<void>;
  /**
   * Stores a new text for a comment the viewer wrote (objectui#12268). Offered
   * on a `comment` row, or a reply, whose `authoredByViewer` the host set; the
   * timeline never decides authorship itself. A rejection means the edit was
   * not stored: the editor keeps the draft, and reporting why is the host's job.
   */
  onEditComment?: (itemId: string | number, text: string) => void | Promise<void>;
  /**
   * Deletes a comment the viewer wrote (objectui#12268), offered on the same
   * rows. The host asks for confirmation first; a rejection means nothing was
   * deleted.
   */
  onDeleteComment?: (itemId: string | number) => void | Promise<void>;
  /** Subscription state */
  subscription?: RecordSubscription;
  /** Called when user toggles subscription */
  onToggleSubscription?: (subscribed: boolean) => void | Promise<void>;
  /** When true, collapse to only the comment input when there are no items */
  collapseWhenEmpty?: boolean;
  /** Optional list of mention suggestions for the rich comment input. */
  mentionSuggestions?: Array<{ id: string; label: string; avatarUrl?: string }>;
  /** Optional uploader for comment attachments. When provided, the composer
   *  exposes a drag-and-drop file panel. */
  onUploadAttachments?: (files: FileList) => Promise<Attachment[]>;
  /** Override the panel title (defaults to t('detail.activity')). It is both
   *  the visible heading's title and the panel landmark's accessible name
   *  (objectui#9998). */
  titleLabel?: string;
  /** Override the empty state copy (defaults to t('detail.noActivity')) */
  emptyLabel?: string;
  /**
   * The feed's activity read was REFUSED (401 / 403, or a permission
   * envelope). The timeline then says the reader may not see the activity,
   * instead of claiming there is none (objectui#11195). The host that owns the
   * read decides this; the timeline never guesses it.
   */
  activityDenied?: boolean;
  /** The same, for the feed's comment read. */
  commentsDenied?: boolean;
  className?: string;
}

// Total over `FeedItemType`, so a feed kind the spec adds cannot reach the
// timeline without an icon and a colour (objectstack#4115): the six entries
// below `call` were missing for as long as the local union was a 7-member
// hand copy of the spec's 13.
const FEED_TYPE_ICONS: Record<FeedItemType, React.ElementType> = {
  comment: MessageSquare,
  field_change: Edit,
  task: CheckSquare,
  event: Calendar,
  system: Zap,
  email: Mail,
  call: Phone,
  note: StickyNote,
  file: FileText,
  sharing: Share2,
  record_create: PlusCircle,
  record_delete: Trash2,
  approval: BadgeCheck,
};

const FEED_TYPE_COLORS: Record<FeedItemType, string> = {
  comment: 'bg-purple-100 text-purple-600',
  field_change: 'bg-blue-100 text-blue-600',
  task: 'bg-green-100 text-green-600',
  event: 'bg-amber-100 text-amber-600',
  system: 'bg-gray-100 text-gray-600',
  email: 'bg-indigo-100 text-indigo-600',
  call: 'bg-teal-100 text-teal-600',
  note: 'bg-yellow-100 text-yellow-700',
  file: 'bg-slate-100 text-slate-600',
  sharing: 'bg-sky-100 text-sky-600',
  record_create: 'bg-emerald-100 text-emerald-600',
  record_delete: 'bg-red-100 text-red-600',
  approval: 'bg-violet-100 text-violet-600',
};

function getFilterOptions(t: (key: string) => string): { value: FeedFilterMode; label: string }[] {
  return [
    { value: 'all', label: t('detail.allActivity') },
    { value: 'comments_only', label: t('detail.commentsOnly') },
    { value: 'changes_only', label: t('detail.fieldChangesFilter') },
    { value: 'tasks_only', label: t('detail.tasksOnly') },
  ];
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
 * Whether a feed row can store a reaction (objectui#11035).
 *
 * A reaction is stored in `sys_comment.reactions`, and `comment` is the one feed
 * kind built from a `sys_comment` row (the record page's `sys_comment` read and
 * the rows its composer adds). Every other kind comes from a source with no
 * reaction store: a `sys_activity` row reaches the feed through
 * `activityRowToFeedItem`, whose kinds never include `comment`. So only a
 * comment row offers the reaction control. Before this gate an activity row's
 * Add reaction handed the host the activity's id, and the record page wrote
 * `sys_comment` by it. Reactions a host hands on any other row still show, as
 * chips that cannot be clicked. Pinned by
 * `RecordActivityTimeline.reactionsCommentRowsOnly-11035.test.tsx`.
 */
function canStoreReaction(item: FeedItem): boolean {
  return item.type === 'comment';
}

/**
 * Whether a feed row can take a reply (objectui#12144).
 *
 * A reply is a `sys_comment` row whose `parent_id` names the comment it
 * answers, so only a `comment` row offers the reply input. A row read from
 * `sys_activity` offers none: a reply there would store a comment whose parent
 * is an activity, which no read shows under it. Same reasoning as
 * {@link canStoreReaction}.
 */
function canTakeReply(item: FeedItem): boolean {
  return item.type === 'comment';
}

/** The reply list a row shows while its `replyCount` is zero (objectui#12144). */
const NO_REPLIES: FeedItem[] = [];

function filterItems(items: FeedItem[], mode: FeedFilterMode): FeedItem[] {
  switch (mode) {
    case 'comments_only':
      return items.filter((i) => i.type === 'comment');
    case 'changes_only':
      return items.filter((i) => i.type === 'field_change');
    case 'tasks_only':
      return items.filter((i) => i.type === 'task');
    default:
      return items;
  }
}

/**
 * RecordActivityTimeline — Unified timeline renderer for Airtable-style activity feeds.
 *
 * Renders different feed item types (comment, field_change, task, event, system, etc.)
 * in a unified timeline. Supports filtering, pagination, reactions, and threading.
 *
 * Aligned with @objectstack/spec RecordActivityProps.
 */
export const RecordActivityTimeline: React.FC<RecordActivityTimelineProps> = ({
  items,
  config,
  filterMode: controlledFilter,
  onFilterChange,
  hasMore = false,
  onLoadMore,
  loading = false,
  onAddComment,
  onAddReply,
  onToggleReaction,
  onEditComment,
  onDeleteComment,
  subscription,
  onToggleSubscription,
  collapseWhenEmpty = false,
  mentionSuggestions,
  onUploadAttachments,
  titleLabel,
  emptyLabel,
  activityDenied = false,
  commentsDenied = false,
  className,
}) => {
  const { t } = useDetailTranslation();
  // The BCP-47 tag the absolute-date tail formats with (objectui#9786).
  const displayLocale = useDisplayLocale();
  const [internalFilter, setInternalFilter] = React.useState<FeedFilterMode>('all');
  const [commentText, setCommentText] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [pendingAttachments, setPendingAttachments] = React.useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = React.useState(false);
  // ONE value for the visible heading's title AND the landmark's name — see the
  // `<section>` below (objectui#9998).
  const title = titleLabel ?? t('detail.activity');

  // objectui#11195: which of the feed's reads the server REFUSED, one line per
  // refused source. It renders in place of the empty state when there are no
  // rows, and above the rows when there are some. Visually distinct from the
  // empty state on purpose: a lock and a left-aligned sentence, not the
  // centred inbox glyph `DataEmptyState` draws.
  const deniedNotice =
    activityDenied || commentsDenied ? (
      <div
        role="status"
        data-testid="activity-access-denied"
        className="flex flex-col gap-2 py-4 text-sm text-muted-foreground"
      >
        {activityDenied && (
          <p data-denied-source="activity" className="flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('detail.activityAccessDenied')}</span>
          </p>
        )}
        {commentsDenied && (
          <p data-denied-source="comments" className="flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('detail.commentsAccessDenied')}</span>
          </p>
        )}
      </div>
    ) : null;

  const activeFilter = controlledFilter ?? internalFilter;
  const showFilter = config?.showFilterToggle !== false;
  const showCommentInput = config?.showCommentInput !== false && !!onAddComment;
  const enableReactions = config?.enableReactions ?? false;
  const enableThreading = config?.enableThreading ?? false;
  const showSubscription = config?.showSubscriptionToggle ?? false;

  const filtered = React.useMemo(
    () => filterItems(items, activeFilter),
    [items, activeFilter],
  );

  // Group replies by parentId.
  //
  // A reply nests under its parent only when the feed holds that parent. One
  // whose `parentId` names no item here is a row of its own, in its place
  // (objectui#12268): its parent was deleted (the server keeps the replies),
  // or it lies before the current page and "Load more" has not brought it in.
  // Before, such a reply was dropped from the roots and nested under nothing,
  // so deleting a comment hid every reply to it, another member's included.
  // "Holds" is decided on `items`, by the identity the nesting below keys on
  // (a `Map` key, SameValueZero). Who may delete what is not decided here:
  // the server stays the authority, and the client cascades nothing.
  const rootItems = React.useMemo(() => {
    if (!enableThreading) return filtered;
    const held = new Set<string | number>(items.map((i) => i.id));
    return filtered.filter((i) => !i.parentId || !held.has(i.parentId));
  }, [filtered, items, enableThreading]);

  const repliesByParent = React.useMemo(() => {
    if (!enableThreading) return new Map<string | number, FeedItem[]>();
    const map = new Map<string | number, FeedItem[]>();
    for (const item of filtered) {
      if (item.parentId) {
        const existing = map.get(item.parentId) ?? [];
        existing.push(item);
        map.set(item.parentId, existing);
      }
    }
    return map;
  }, [filtered, enableThreading]);

  const handleFilterChange = React.useCallback(
    (mode: FeedFilterMode) => {
      if (onFilterChange) {
        onFilterChange(mode);
      } else {
        setInternalFilter(mode);
      }
    },
    [onFilterChange],
  );

  const handleAddComment = React.useCallback(async () => {
    const text = commentText.trim();
    if (!onAddComment) return;
    // Allow attachment-only comments when at least one file is attached.
    if (!text && pendingAttachments.length === 0) return;
    setIsSubmitting(true);
    try {
      await onAddComment(
        text,
        pendingAttachments.length > 0 ? pendingAttachments : undefined,
      );
      setCommentText('');
      setPendingAttachments([]);
    } catch {
      // A rejection means the comment was NOT written (objectui#10899). The
      // host reports why; the composer's part is to keep the draft and its
      // attachments so the user can retry without retyping.
    } finally {
      setIsSubmitting(false);
    }
  }, [commentText, pendingAttachments, onAddComment]);

  const handleUpload = React.useCallback(
    async (files: FileList) => {
      if (!onUploadAttachments || files.length === 0) return;
      setIsUploading(true);
      try {
        const uploaded = await onUploadAttachments(files);
        if (Array.isArray(uploaded) && uploaded.length > 0) {
          setPendingAttachments((prev) => [...prev, ...uploaded]);
        }
      } finally {
        setIsUploading(false);
      }
    },
    [onUploadAttachments],
  );

  const handleRemoveAttachment = React.useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleLoadMore = React.useCallback(async () => {
    if (!onLoadMore) return;
    setIsLoadingMore(true);
    try {
      await onLoadMore();
    } finally {
      setIsLoadingMore(false);
    }
  }, [onLoadMore]);

  return (
    <section
      // De-boxed: render as a naked section with a top divider instead of
      // the previous bordered Card. This keeps the discussion panel
      // visually consistent with the rest of the record-detail page
      // (highlights + tabs are also naked). When the chatter panel is
      // pinned to the right rail it wraps this with its own border, so
      // we don't double up.
      className={cn(
        'border-t border-border/60 pt-5',
        className,
      )}
      // Named with the heading's own title value, not a second string
      // (objectui#9998). This used to be a fixed `t('detail.discussion')`
      // while the heading read `titleLabel ?? t('detail.activity')`, so a
      // `record:activity` mount (no `titleLabel`) was a region spoken
      // "Discussion" under a heading reading "Activity (N)". The repo's own
      // rule is objectui#4118's: a speech-input user says what they see, so
      // the landmark's spoken name must be the heading, not a paraphrase.
      // The `(N)` count stays out of the name: it is live status that moves
      // with the filter, not what anyone says to name the panel.
      // ⛔ Not `aria-labelledby` + `React.useId()`: two timelines can share a
      // page, so the id must be per instance, and a `useId` value differs on
      // every mount. `record-block-record-reach.test.tsx` (apps/console) and
      // `palette-discussion-alias.test.tsx` (app-shell) both compare two
      // mounts' HTML byte for byte, and both went red on that id.
      aria-label={title}
    >
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight">
            <Activity className="h-4 w-4" />
            {title}
            <span className="text-sm font-normal text-muted-foreground">
              ({filtered.length})
            </span>
          </h2>
          <div className="flex items-center gap-1">
            {showSubscription && subscription && (
              <SubscriptionToggle
                subscription={subscription}
                onToggle={onToggleSubscription}
              />
            )}
          </div>
        </div>
      </header>
      <div className="space-y-4">
        {/* Filter dropdown */}
        {showFilter && (
          <div className="flex items-center gap-2">
            <Select
              value={activeFilter}
              onValueChange={(v) => handleFilterChange(v as FeedFilterMode)}
            >
              <SelectTrigger
                aria-label={t('detail.filterActivity')}
                className="h-8 w-auto min-w-[140px] py-1 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {getFilterOptions(t).map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Comment Input — rich text with @mention + bold/italic/list/code + preview */}
        {showCommentInput && (
          <RichTextCommentInput
            value={commentText}
            onChange={setCommentText}
            onSubmit={handleAddComment}
            mentionSuggestions={mentionSuggestions}
            placeholder={t('detail.leaveCommentPlaceholder')}
            disabled={isSubmitting}
            canSubmitEmpty={pendingAttachments.length > 0}
            extraSlot={
              onUploadAttachments ? (
                <CommentAttachment
                  attachments={pendingAttachments}
                  onUpload={handleUpload}
                  onRemove={handleRemoveAttachment}
                  readOnly={isSubmitting || isUploading}
                />
              ) : pendingAttachments.length > 0 ? (
                <CommentAttachment
                  attachments={pendingAttachments}
                  onRemove={handleRemoveAttachment}
                  readOnly={isSubmitting}
                />
              ) : undefined
            }
          />
        )}

        {/* A refusal with rows on screen (objectui#11195): the comments
            were readable and the activity was not, or the other way round.
            The rows stay, and the notice above them says which half the
            reader may not see. Without it the rows would read as the whole
            story. With no rows, the notice is the branch below instead. */}
        {filtered.length > 0 && deniedNotice}

        {/* Timeline.
            The loading branch comes FIRST because "still fetching" and "no
            activity" are different answers, and only one of them is true
            while the feed is in flight (objectui#3205). Until this branch
            existed the panel spent every fetch asserting the record had no
            activity, then contradicted itself when the rows arrived.
            `collapseWhenEmpty` does not suppress it: that flag is about the
            EMPTY state ("collapse when there are no items"), and during a
            fetch we do not yet know whether there are items.
            Note the guard is `filtered.length === 0`, not `loading` alone —
            a refresh or a "Load more" round-trip must not blank a feed that
            is already on screen (that would lose the reader's position, and
            "Load more" carries its own spinner). */}
        {loading && filtered.length === 0 ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="activity-loading"
            className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t('detail.loading')}</span>
          </div>
        ) : (activityDenied || commentsDenied) && filtered.length === 0 ? (
          // objectui#11195: a REFUSED read is not an empty one. This branch
          // comes before the empty state because "you may not see this" and
          // "there is nothing here" are different answers, and only the first
          // is true when the server refused the read. The empty state's copy
          // is a claim about the record, and a refusal gives no evidence for
          // it. Only the i18n sentence is rendered: no status code, no server
          // message, no object name.
          deniedNotice
        ) : filtered.length === 0 ? (
          collapseWhenEmpty ? null : (
            <DataEmptyState
              title={emptyLabel ?? t('detail.noActivity')}
              className="py-6"
            />
          )
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-2 bottom-2 w-px bg-border" />

            <div className="space-y-4">
              {rootItems.map((item) => {
                const Icon = FEED_TYPE_ICONS[item.type] || Zap;
                const colorClass =
                  FEED_TYPE_COLORS[item.type] || 'bg-gray-100 text-gray-600';
                // Threading (objectui#12144). The reply LIST shows only under a
                // `replyCount` above zero, the one threading gate: the host that
                // read the rows sets it. The reply INPUT does not wait for a
                // first reply, so a comment with none offers it wherever the
                // host hands over `onAddReply`.
                const replies =
                  (item.replyCount ?? 0) > 0 ? (repliesByParent.get(item.id) ?? NO_REPLIES) : NO_REPLIES;
                const offersReply = !!onAddReply && canTakeReply(item);
                // Undefined on a row that cannot store a reaction: no Add
                // reaction button, and its chips render disabled (objectui#11035).
                const toggleReaction =
                  enableReactions && onToggleReaction && canStoreReaction(item)
                    ? (emoji: string) => onToggleReaction(item.id, emoji)
                    : undefined;

                return (
                  <div key={item.id}>
                    <div className="flex gap-3 relative">
                      {/* Icon */}
                      <div
                        className={cn(
                          'shrink-0 h-8 w-8 rounded-full flex items-center justify-center z-10',
                          colorClass,
                        )}
                      >
                        {item.actorAvatarUrl ? (
                          <img
                            src={item.actorAvatarUrl}
                            alt={item.actor}
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <Icon className="h-3.5 w-3.5" />
                        )}
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0 pt-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium">{item.actor}</span>
                          {item.source && (
                            <span className="text-xs text-muted-foreground">
                              {t('detail.via', { source: item.source })}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(item.createdAt, t, displayLocale)}
                          </span>
                          {item.edited && (
                            <span className="text-xs text-muted-foreground italic">{t('detail.edited')}</span>
                          )}
                          {item.pinned && (
                            <span className="text-xs text-amber-600">📌 {t('detail.pinned')}</span>
                          )}
                        </div>

                        {/* Body text, and the author's Edit and Delete on their own
                            comment (objectui#12268). The host decides whose
                            comment it is (`authoredByViewer`) and hands each
                            handler over under the caller's grant; a row that
                            offers neither renders the same paragraph as before. */}
                        <CommentBody
                          item={item}
                          onEditComment={onEditComment}
                          onDeleteComment={onDeleteComment}
                          bodyClassName="text-sm whitespace-pre-wrap break-words text-muted-foreground"
                        />

                        {/* Drill to source rich entity (ADR-0052 ActivityPointer) */}
                        {item.sourceObject && item.sourceId != null && (
                          <a
                            href={`/objects/${item.sourceObject}/${item.sourceId}`}
                            className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            data-testid="activity-source-link"
                          >
                            {t('detail.viewSource')}
                            <span aria-hidden>→</span>
                          </a>
                        )}

                        {/* Field changes */}
                        {item.type === 'field_change' && item.fieldChanges && (
                          <div className="space-y-1 mt-1">
                            {item.fieldChanges.map((change, idx) => (
                              <FieldChangeItem key={idx} change={change} />
                            ))}
                          </div>
                        )}

                        {/* Reactions */}
                        {enableReactions && item.reactions && item.reactions.length > 0 && (
                          <div className="mt-1.5">
                            <ReactionPicker
                              reactions={item.reactions}
                              onToggleReaction={toggleReaction}
                            />
                          </div>
                        )}

                        {/* Add reaction button (even if no reactions yet) */}
                        {(!item.reactions || item.reactions.length === 0) && toggleReaction && (
                          <div className="mt-1.5">
                            <ReactionPicker
                              reactions={[]}
                              onToggleReaction={toggleReaction}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Threading */}
                    {enableThreading && (replies.length > 0 || offersReply) && (
                      <ThreadedReplies
                        parentItem={item}
                        replies={replies}
                        onAddReply={onAddReply}
                        showReplyInput={offersReply}
                        onEditComment={onEditComment}
                        onDeleteComment={onDeleteComment}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Load More */}
        {hasMore && (
          <div className="text-center pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              aria-label={t('detail.loadMore')}
            >
              {isLoadingMore ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <ChevronDown className="h-4 w-4 mr-1" />
              )}
              {t('detail.loadMore')}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
};
