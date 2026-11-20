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
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import type { FeedItem, FeedItemType, RecordActivityComponentProps, RecordSubscription } from '@object-ui/types';
import type { FeedFilterMode } from '@objectstack/spec/data';
import { ReactionPicker } from './ReactionPicker';
import { ThreadedReplies } from './ThreadedReplies';
import { SubscriptionToggle } from './SubscriptionToggle';
import { RichTextCommentInput } from './RichTextCommentInput';
import { CommentAttachment, type Attachment } from './CommentAttachment';
import { CommentBody } from './CommentAuthorControls';
import { useDisplayLocale } from '@object-ui/i18n';
import { useRecordContext, useSafeFieldLabel } from '@object-ui/react';
import { useDetailTranslation } from './useDetailTranslation';
import {
  foldFeedItems,
  readerRecordNameOf,
  withReaderRecordName,
  type ActivityTimelineEntry,
} from './renderers/recordActivityFeed';
import {
  RecordFieldHistoryContext,
  TIMELINE_STREAM_FILTERS,
  fieldHistoryEntriesOf,
  fieldHistoryOf,
  isFieldHistoryEntry,
  filterTimelineStream,
  isSystemStreamEntry,
  timelineStreamFilters,
  type TimelineStreamFilter,
} from './recordTimelineStream';

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
  /**
   * Whether the feed this timeline draws can show a comment at all
   * (objectstack#34371). `false` — a `types` allow-list that leaves out
   * `comment` — withdraws the comment composer and the Comments-only filter, so
   * the timeline never offers a post it would then filter out of view. Absent
   * means `true`.
   */
  commentsShown?: boolean;
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
  /** Called on the comment input's focus, for the host to read {@link mentionSuggestions} (objectstack#28470). */
  onMentionSuggestionsWanted?: () => void;
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
  /**
   * The feed's activity read FAILED: a 5xx or a network failure, not a
   * refusal (objectstack#29188). The timeline then says the activity could
   * not be loaded, with a Retry, instead of claiming there is none. The host
   * that owns the read decides this.
   */
  activityFailed?: boolean;
  /** The same, for the feed's comment read. */
  commentsFailed?: boolean;
  /** Read the failed feed reads again; the load-failure notice's Retry calls it. */
  onRetryFeed?: () => void;
  /**
   * objectstack#27055, Target 3 — `stream` is the record page's 动态 stream
   * in full (the 动态 tab): the filter chips 全部 / 活动 / 讨论 / 变更 on the
   * title row instead of the dropdown, system entries (field changes, system
   * events) as one compact muted line each, and paging at the foot.
   * objectstack#27524, Target 5 — `peek` is the body of the 动态 panel, the
   * first panel of the right column: a one-line composer that opens the full
   * one when pressed, the entries it is handed as one line each, and
   * 「查看全部 N 条 →」 (`onViewAll`); no chips, no title — the panel draws
   * the header. `panel` (the default) is the block as it has always been.
   */
  variant?: 'panel' | 'stream' | 'peek';
  /** The stream's chip (controlled); `all` when absent. */
  streamFilter?: TimelineStreamFilter;
  /** The chips the stream offers, in order; all four when absent (objectstack#30074). */
  streamFilters?: readonly TimelineStreamFilter[];
  onStreamFilterChange?: (filter: TimelineStreamFilter) => void;
  /** How many entries the whole stream holds, for the peek's 「查看全部 N 条 →」. */
  totalCount?: number;
  /** The peek's 「查看全部 N 条 →」: open the 动态 tab. Absent: not drawn. */
  onViewAll?: () => void;
  /**
   * The stream's 「看审批」 on an approval entry: open the record's approvals.
   * Absent: the entry is its one line with no link.
   */
  onViewApprovals?: () => void;
  className?: string;
}

/** The stream chips' copy (objectstack#27055): 全部 / 活动 / 讨论 / 变更. */
/** A comment's icon cell: the row's 14 px icon, centred on its first line. */
const STREAM_ICON_CELL = 'shrink-0 flex h-[30px] w-3.5 items-center justify-center text-muted-foreground';
/** A comment's header line: who, then when, 30 px tall, wrapping between pieces. */
const STREAM_COMMENT_HEADER = 'flex min-h-[30px] flex-wrap items-center gap-x-2 text-[13px]';
/**
 * A comment's actions, drawn on hover or keyboard focus within its row, and
 * always on a touch screen, which has no hover.
 */
const ROW_ACTIONS_REVEAL =
  'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100';

const STREAM_FILTER_KEYS: Record<TimelineStreamFilter, { key: string; fallback: string }> = {
  all: { key: 'detail.streamAll', fallback: 'All' },
  activity: { key: 'detail.streamActivity', fallback: 'Activity' },
  discussion: { key: 'detail.streamDiscussion', fallback: 'Discussion' },
  changes: { key: 'detail.streamChanges', fallback: 'Changes' },
};

// Total over `FeedItemType`, so a feed kind the spec adds cannot reach the
// timeline without an icon (objectstack#4115): the six entries
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

/**
 * Whether a stream entry is one person's field change, the kind
 * {@link foldStreamChanges} folds: an audit entry or an `updated` activity
 * row, not a milestone (`activityKind`) and not a reply.
 */
function isStreamFieldChange(item: FeedItem): boolean {
  return (
    item.type === 'field_change'
    && (isFieldHistoryEntry(item) || item.activityType === 'updated')
    && item.activityKind === undefined
    && !item.parentId
  );
}

/** The local calendar day an entry was written on (`YYYY-M-D`), or '' when unparseable. */
function dayKeyOf(createdAt: string | undefined): string {
  const date = createdAt ? new Date(createdAt) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * The stream's display grouping: consecutive field changes by one person
 * (the same `actorId` and display name) on one day become ONE fold row, which
 * expands to each change. Every entry stays in the stream, in order; nothing
 * is merged in the data. A run of one is an ordinary row.
 */
export function foldStreamChanges(items: readonly FeedItem[]): ActivityTimelineEntry[] {
  const entries: ActivityTimelineEntry[] = [];
  let run: FeedItem[] = [];
  const flush = () => {
    if (run.length > 1) entries.push({ kind: 'fold', id: `fold:${String(run[0].id)}`, items: run });
    else if (run.length === 1) entries.push({ kind: 'item', item: run[0] });
    run = [];
  };
  for (const item of items) {
    if (!isStreamFieldChange(item)) {
      flush();
      entries.push({ kind: 'item', item });
      continue;
    }
    const prev = run[run.length - 1];
    if (
      prev
      && ((prev.actorId ?? null) !== (item.actorId ?? null)
        || prev.actor !== item.actor
        || dayKeyOf(prev.createdAt) !== dayKeyOf(item.createdAt))
    ) {
      flush();
    }
    run.push(item);
  }
  flush();
  return entries;
}

/** The fields a stream field change names: its own list, its changes, or its paired audit entry's. */
function streamChangedFieldsOf(item: FeedItem): string[] {
  if (item.changedFields && item.changedFields.length > 0) return item.changedFields;
  const changes = fieldHistoryOf(item)?.fieldChanges ?? item.fieldChanges ?? [];
  return changes.map((change) => change.field);
}

/**
 * The dropdown's options, given whether the record's field history is shown
 * (`RecordFieldHistoryContext`): `changes_only` is offered exactly when the
 * stream offers its 变更 chip — the one rule, `timelineStreamFilters`
 * (objectstack#30074, objectstack#30344). `comments_only` is offered exactly
 * when the feed can show a comment (`commentsShown`, objectstack#34371).
 */
function getFilterOptions(
  t: (key: string) => string,
  fieldHistory: boolean,
  commentsShown: boolean,
): { value: FeedFilterMode; label: string }[] {
  const changesOffered = timelineStreamFilters(fieldHistory).includes('changes');
  return [
    { value: 'all', label: t('detail.allActivity') },
    // A feed that cannot show a comment offers no filter for them (objectstack#34371).
    ...(commentsShown ? [{ value: 'comments_only' as const, label: t('detail.commentsOnly') }] : []),
    ...(changesOffered ? [{ value: 'changes_only' as const, label: t('detail.fieldChangesFilter') }] : []),
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
    // The stream's 变更 rule (objectstack#30074, ruling C): the audit's field
    // changes only, so the panel and the stream agree on what a change is.
    case 'changes_only':
      return fieldHistoryEntriesOf(items);
    case 'tasks_only':
      return items.filter((i) => i.type === 'task');
    default:
      return items;
  }
}

/** The distinct changed fields of a run, in first-seen order. */
function changedFieldsOf(items: readonly FeedItem[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    for (const field of item.changedFields ?? []) seen.add(field);
  }
  return Array.from(seen);
}

/** How many field labels a folded row names before it says "+N". */
const FOLD_FIELDS_SHOWN = 3;

/**
 * RecordActivityTimeline — Unified timeline renderer for Airtable-style activity feeds.
 *
 * Renders different feed item types (comment, field_change, task, event, system, etc.)
 * in a unified timeline. Supports filtering, pagination, reactions, and threading.
 *
 * Aligned with @objectstack/spec RecordActivityProps.
 */
export const RecordActivityTimeline: React.FC<RecordActivityTimelineProps> = ({
  items: handedItems,
  config,
  filterMode: controlledFilter,
  onFilterChange,
  hasMore = false,
  onLoadMore,
  loading = false,
  onAddComment,
  commentsShown = true,
  onAddReply,
  onToggleReaction,
  onEditComment,
  onDeleteComment,
  subscription,
  onToggleSubscription,
  collapseWhenEmpty = false,
  mentionSuggestions,
  onMentionSuggestionsWanted,
  onUploadAttachments,
  titleLabel,
  emptyLabel,
  activityDenied = false,
  commentsDenied = false,
  activityFailed = false,
  commentsFailed = false,
  onRetryFeed,
  variant = 'panel',
  streamFilter = 'all',
  streamFilters = TIMELINE_STREAM_FILTERS,
  onStreamFilterChange,
  totalCount,
  onViewAll,
  onViewApprovals,
  className,
}) => {
  const isPeek = variant === 'peek';
  const isStream = variant === 'stream' || isPeek;
  const { t } = useDetailTranslation();
  // The BCP-47 tag the absolute-date tail formats with (objectui#9786).
  const displayLocale = useDisplayLocale();
  const [internalFilter, setInternalFilter] = React.useState<FeedFilterMode>('all');
  const [commentText, setCommentText] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [pendingAttachments, setPendingAttachments] = React.useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = React.useState(false);
  // The peek's composer is one line until the reader presses it.
  const [composerOpen, setComposerOpen] = React.useState(false);
  // ONE value for the visible heading's title AND the landmark's name — see the
  // `<section>` below (objectui#9998).
  const title = titleLabel ?? t('detail.activity');

  // The page's record (`RecordContextProvider`): its object schema labels a
  // changed field below, and its name is the one the summaries say.
  const recordContext = useRecordContext();
  // objectstack#29962 — an activity summary names the record as its WRITER
  // read it, stored when the write happened. For an object whose name field is
  // a formula (`label(record.FIELD)`) that is the writer's language, so each
  // row of this record names it as this reader reads it: the H1's name. Every
  // place below that draws a summary reads these items.
  const readerName = readerRecordNameOf(recordContext?.objectSchema, recordContext?.data, recordContext?.recordId);
  const readerRecordId = readerName?.recordId;
  const readerRecordName = readerName?.name;
  const items = React.useMemo(
    () =>
      withReaderRecordName(
        handedItems,
        readerRecordId !== undefined && readerRecordName !== undefined
          ? { recordId: readerRecordId, name: readerRecordName }
          : null,
      ),
    [handedItems, readerRecordId, readerRecordName],
  );

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

  // objectstack#29188: which of the feed's reads FAILED (a 5xx or a network
  // failure), one line per failed source, and a Retry when the host offers
  // one. Placed where the refusal notice is: in place of the empty state with
  // no rows, above the rows with some. A failed read is not "nothing here",
  // and only the i18n sentence is rendered: no status code, no server text.
  const failedNotice =
    activityFailed || commentsFailed ? (
      <div
        role="alert"
        data-testid="activity-load-failed"
        className="flex flex-col items-start gap-2 py-4 text-sm text-muted-foreground"
      >
        {activityFailed && (
          <p data-failed-source="activity" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('detail.activityLoadFailed')}</span>
          </p>
        )}
        {commentsFailed && (
          <p data-failed-source="comments" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('detail.commentsLoadFailed')}</span>
          </p>
        )}
        {onRetryFeed && (
          <Button type="button" variant="outline" size="sm" onClick={onRetryFeed} disabled={loading} data-feed-retry="">
            <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('detail.retryLoadFeed')}
          </Button>
        )}
      </div>
    ) : null;
  // A read that did not answer, refused or failed: the rows on screen (if
  // any) are not the whole story, and the count is unknown.
  const readUnanswered = activityDenied || commentsDenied || activityFailed || commentsFailed;
  const readNotice = readUnanswered ? (
    <>
      {deniedNotice}
      {failedNotice}
    </>
  ) : null;

  // A filter the dropdown does not offer filters nothing: it reads as `all`,
  // as the stream's chips do.
  const filterOptions = getFilterOptions(t, React.useContext(RecordFieldHistoryContext), commentsShown);
  const chosenFilter = controlledFilter ?? internalFilter;
  const activeFilter: FeedFilterMode = filterOptions.some((opt) => opt.value === chosenFilter) ? chosenFilter : 'all';
  const showFilter = config?.showFilterToggle !== false;
  const showCommentInput = config?.showCommentInput !== false && !!onAddComment && commentsShown;
  const enableReactions = config?.enableReactions ?? false;
  const enableThreading = config?.enableThreading ?? false;
  const showSubscription = config?.showSubscriptionToggle ?? false;

  const filtered = React.useMemo(
    () => (isStream ? filterTimelineStream(items, streamFilter) : filterItems(items, activeFilter)),
    [items, activeFilter, isStream, streamFilter],
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

  // Runs of consecutive updates by one actor, folded into one row each
  // (objectstack#25959). Folded at render from the rows the reader sees; the
  // feed itself keeps every entry.
  // The stream folds a run of one person's field changes on one day into one
  // expandable row ({@link foldStreamChanges}): display grouping only.
  const timelineEntries = React.useMemo(
    (): ActivityTimelineEntry[] => (isStream ? foldStreamChanges(rootItems) : foldFeedItems(rootItems)),
    [rootItems, isStream],
  );
  // Which folded rows the reader has expanded, by the fold's id.
  const [expandedFolds, setExpandedFolds] = React.useState<ReadonlySet<string>>(() => new Set());
  const toggleFold = React.useCallback((id: string) => {
    setExpandedFolds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Which comments the reader opened the reply input under, by the comment's id.
  const [openReplies, setOpenReplies] = React.useState<ReadonlySet<string | number>>(() => new Set());
  const toggleReply = React.useCallback((id: string | number) => {
    setOpenReplies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // A changed field's label: the object's field label where the page has the
  // object schema (`RecordContextProvider`), through the same translated
  // `fieldLabel` the record's own sections use; the machine name otherwise.
  const { fieldLabel } = useSafeFieldLabel();
  const labelOfField = React.useCallback(
    (name: string): string => {
      const objectName = recordContext?.objectName;
      const def = (recordContext?.objectSchema as { fields?: Record<string, { label?: unknown }> } | undefined)
        ?.fields?.[name];
      const authored = typeof def?.label === 'string' && def.label ? def.label : name;
      return objectName ? fieldLabel(objectName, name, authored) : authored;
    },
    [recordContext?.objectName, recordContext?.objectSchema, fieldLabel],
  );

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
      setComposerOpen(false);
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

  // One feed item's row. A folded run renders each of its entries with this
  // same function when expanded (objectstack#25959).
  // objectstack#27055 — a system entry of the stream: ONE muted line, the
  // change itself, then who and when. 「状态 新建 → 已联系 · Dev Admin · 昨天」.
  const changesText = (item: FeedItem): string =>
    (item.fieldChanges ?? [])
      .map((change) => {
        const label = change.fieldLabel || labelOfField(change.field);
        const from = change.oldDisplayValue ?? (change.oldValue == null ? '' : String(change.oldValue));
        const to = change.newDisplayValue ?? (change.newValue == null ? '' : String(change.newValue));
        return `${label} ${from || '—'} → ${to || '—'}`;
      })
      .join('; ');
  // An activity row paired with its audit entry (objectstack#30122) reads as
  // its own summary; the before and after values sit on the same row.
  const systemLineText = (item: FeedItem): string => {
    const changes = fieldHistoryOf(item) ? '' : changesText(item);
    return changes
      ? changes
      : item.body && item.body.trim()
        ? item.body
        : item.changedFields && item.changedFields.length > 0
          ? t('detail.foldedUpdates', {
              fields: item.changedFields.map(labelOfField).join(t('validation.formInvalidJoiner')),
            })
          : t('detail.activityUpdated');
  };
  // The stream's dense row (the record page's 动态 tab): a small icon, who,
  // what, and the time at the right, on ONE 30 px line. The what truncates
  // (its whole text is the row's title) and the time never breaks
  // (objectstack#34614), so a narrow drawer keeps one line per entry.
  const streamRow = (
    item: FeedItem,
    Icon: React.ElementType,
    what: React.ReactNode,
    whatTitle: string,
    extra?: React.ReactNode,
    rowProps?: Record<string, string>,
  ): React.ReactNode => {
    const when = formatTimestamp(item.createdAt, t, displayLocale);
    return (
      <div
        key={item.id}
        className="flex min-h-[30px] items-center gap-2 text-[13px] leading-[18px]"
        title={`${item.actor} · ${whatTitle} · ${when}`}
        data-stream-row=""
        {...rowProps}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="max-w-[40%] shrink-0 truncate font-medium text-foreground" data-stream-actor="">
          {item.actor}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{what}</span>
        {extra}
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums" data-stream-when="">
          {when}
        </span>
      </div>
    );
  };
  const renderSystemLine = (item: FeedItem): React.ReactNode => {
    const Icon = FEED_TYPE_ICONS[item.type] || Zap;
    const what = systemLineText(item);
    const paired = fieldHistoryOf(item);
    const diff = paired ? changesText(paired) : '';
    return streamRow(
      item,
      Icon,
      <>
        <span className="text-foreground/80" data-stream-change="">{what}</span>
        {paired && (
          <>
            <span aria-hidden>{' · '}</span>
            <span data-stream-change-diff="">{diff}</span>
          </>
        )}
      </>,
      diff ? `${what} · ${diff}` : what,
      undefined,
      { 'data-stream-system-row': '' },
    );
  };
  // An approval entry is one line; its progress lives on the approvals tab,
  // which 「看审批」 opens (the epic's direction: no approval detail here).
  const renderApprovalLine = (item: FeedItem): React.ReactNode => {
    const what = (item.body ?? '').replace(/\s+/g, ' ').trim() || t('detail.activityUpdated');
    return streamRow(
      item,
      FEED_TYPE_ICONS.approval,
      what,
      what,
      onViewApprovals ? (
        <button
          type="button"
          className="shrink-0 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onViewApprovals}
          data-stream-view-approval=""
        >
          {t('detail.viewApproval', { defaultValue: 'View approval' })}
        </button>
      ) : undefined,
      { 'data-stream-approval-row': '' },
    );
  };

  const renderItem = (item: FeedItem): React.ReactNode => {
    if (isSystemStreamEntry(item)) return renderSystemLine(item);
    if (item.type === 'approval') return renderApprovalLine(item);
    const Icon = FEED_TYPE_ICONS[item.type] || Zap;
    // Every entry but a comment is its one line: what it says, and a link to
    // its source record where it has one (ADR-0052 ActivityPointer).
    if (item.type !== 'comment') {
      const what = (item.body ?? '').replace(/\s+/g, ' ').trim() || t('detail.activityUpdated');
      return streamRow(
        item,
        Icon,
        what,
        what,
        item.sourceObject && item.sourceId != null ? (
          <a
            href={`/objects/${item.sourceObject}/${item.sourceId}`}
            className="shrink-0 text-xs text-primary hover:underline"
            data-testid="activity-source-link"
          >
            {t('detail.viewSource')}
          </a>
        ) : undefined,
      );
    }
    // Threading (objectui#12144). The reply LIST shows only under a
    // `replyCount` above zero, the one threading gate: the host that read the
    // rows sets it. The reply INPUT does not wait for a first reply: a comment
    // offers it wherever the host hands over `onAddReply`, behind 「回复」.
    const replies =
      (item.replyCount ?? 0) > 0 ? (repliesByParent.get(item.id) ?? NO_REPLIES) : NO_REPLIES;
    const offersReply = !!onAddReply && canTakeReply(item);
    const replyOpen = offersReply && openReplies.has(item.id);
    // Undefined on a row that cannot store a reaction: no Add reaction button,
    // and its chips render disabled (objectui#11035).
    const toggleReaction =
      enableReactions && onToggleReaction && canStoreReaction(item)
        ? (emoji: string) => onToggleReaction(item.id, emoji)
        : undefined;

    // A comment is the row with what they wrote under it: a small icon, who
    // and when on one 30 px line, the comment, and the row's actions (react,
    // reply, the author's edit and delete) revealed on hover or focus.
    return (
      <div key={item.id} className="group" data-stream-comment-row="">
        <div className="relative flex gap-2">
          {/* Icon */}
          <div className={STREAM_ICON_CELL}>
            {item.actorAvatarUrl ? (
              <img src={item.actorAvatarUrl} alt={item.actor} className="h-4 w-4 rounded-full object-cover" />
            ) : (
              <Icon className="h-3.5 w-3.5" />
            )}
          </div>
          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* The row wraps between its pieces and the time is one
                unbreakable piece (objectstack#34614): in a narrow drawer the
                time moves to the next line instead of breaking per word. */}
            <div className={STREAM_COMMENT_HEADER}>
              <span className="text-[13px] font-medium">{item.actor}</span>
              {item.source && (
                <span className="text-xs text-muted-foreground">
                  {t('detail.via', { source: item.source })}
                </span>
              )}
              <span className="text-xs text-muted-foreground whitespace-nowrap" data-feed-when="">
                {formatTimestamp(item.createdAt, t, displayLocale)}
              </span>
              {item.edited && (
                <span className="text-xs text-muted-foreground italic">{t('detail.edited')}</span>
              )}
              {item.pinned && (
                <span className="text-xs text-amber-600">📌 {t('detail.pinned')}</span>
              )}
              {(toggleReaction && (!item.reactions || item.reactions.length === 0)) || offersReply ? (
                <span className={cn('ml-auto flex items-center gap-1', ROW_ACTIONS_REVEAL)}>
                  {toggleReaction && (!item.reactions || item.reactions.length === 0) && (
                    <ReactionPicker reactions={[]} onToggleReaction={toggleReaction} />
                  )}
                  {offersReply && (
                    <button
                      type="button"
                      className="h-6 rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={replyOpen}
                      onClick={() => toggleReply(item.id)}
                      data-feed-reply-toggle=""
                    >
                      {t('detail.reply', { defaultValue: 'Reply' })}
                    </button>
                  )}
                </span>
              ) : null}
            </div>

            {/* Body text, and the author's Edit and Delete on their own
                comment (objectui#12268). The host decides whose
                comment it is (`authoredByViewer`) and hands each
                handler over under the caller's grant; a row that
                offers neither renders the same paragraph as before.
                The body is what the author wrote, so it reads in the
                foreground colour; the muted grey belongs to the meta line
                above it (objectstack#27520 row 14). */}
            <CommentBody
              item={item}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
              bodyClassName="inline text-[13px] leading-5 whitespace-pre-wrap break-words text-foreground"
              controlsClassName={cn('ml-1 inline-flex items-center gap-0.5 align-middle', ROW_ACTIONS_REVEAL)}
            />

            {/* Drill to source rich entity (ADR-0052 ActivityPointer) */}
            {item.sourceObject && item.sourceId != null && (
              <a
                href={`/objects/${item.sourceObject}/${item.sourceId}`}
                className="ml-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                data-testid="activity-source-link"
              >
                {t('detail.viewSource')}
                <span aria-hidden>→</span>
              </a>
            )}

            {/* Reactions */}
            {enableReactions && item.reactions && item.reactions.length > 0 && (
              <div className="mt-1">
                <ReactionPicker reactions={item.reactions} onToggleReaction={toggleReaction} />
              </div>
            )}
          </div>
        </div>

        {/* Threading */}
        {enableThreading && (replies.length > 0 || replyOpen) && (
          <ThreadedReplies
            parentItem={item}
            replies={replies}
            onAddReply={onAddReply}
            showReplyInput={replyOpen}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
          />
        )}
      </div>
    );
  };

  // A run of consecutive updates by one actor, as one row (objectstack#25959):
  // who, when the latest entry was written, how many entries, and the fields
  // they changed. The chevron expands the run to its entries, each drawn as
  // its own row.
  const renderFold = (entry: Extract<ActivityTimelineEntry, { kind: 'fold' }>): React.ReactNode => {
    const latest = entry.items.reduce((a, b) => (Date.parse(b.createdAt) > Date.parse(a.createdAt) ? b : a));
    const count = entry.items.length;
    const labels = (isStream
      ? Array.from(new Set(entry.items.flatMap(streamChangedFieldsOf)))
      : changedFieldsOf(entry.items)
    ).map(labelOfField);
    const shown = labels.slice(0, FOLD_FIELDS_SHOWN);
    const rest = labels.length - shown.length;
    const named = rest > 0 ? [...shown, t('detail.foldedMoreFields', { count: rest })] : shown;
    // No field named on any entry (an unstamped row, or a reader served none
    // of the fields) still reads as updates, and still counts.
    // Joined with the pack's list punctuation, the key the form's field lists
    // use: `Intl.ListFormat` was measured and rejected there, because its
    // `unit` styles join zh and ru with no separator at all.
    const summary = named.length > 0
      ? t('detail.foldedUpdates', { fields: named.join(t('validation.formInvalidJoiner')) })
      : t('detail.activityUpdated');
    const expanded = expandedFolds.has(entry.id);
    return (
      <div key={entry.id} data-testid="activity-fold" data-fold-count={count}>
        {streamRow(
          latest,
          FEED_TYPE_ICONS.field_change,
          summary,
          summary,
          <>
            <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground" data-testid="activity-fold-count">
              {t('detail.foldedUpdateCount', { count })}
            </span>
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? t('detail.collapseFolded') : t('detail.expandFolded')}
              onClick={() => toggleFold(entry.id)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
            </button>
          </>,
          { 'data-stream-fold-row': '' },
        )}
        {expanded && (
          <div className="ml-1.5 border-l border-border pl-3" data-testid="activity-fold-entries">
            {entry.items.map((item) => renderItem(item))}
          </div>
        )}
      </div>
    );
  };

  const composer = (
    <RichTextCommentInput
      value={commentText}
      onChange={setCommentText}
      onSubmit={handleAddComment}
      mentionSuggestions={mentionSuggestions}
      onMentionSuggestionsWanted={onMentionSuggestionsWanted}
      placeholder={t('detail.leaveCommentPlaceholder')}
      disabled={isSubmitting}
      canSubmitEmpty={pendingAttachments.length > 0}
      autoFocus={isPeek}
      compact={!isPeek}
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
  );

  // The peek's composer: ONE line until the reader presses it (or a draft is
  // held), then the full composer, focused. The panel and the stream draw the
  // composer itself, one line until focused (`compact`).
  const composerLine =
    composerOpen || commentText || pendingAttachments.length > 0 ? (
      composer
    ) : (
      <button
        type="button"
        className="flex h-11 sm:h-8 w-full items-center rounded-md border border-input bg-background px-2.5 text-left text-[12.5px] text-muted-foreground transition-colors hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setComposerOpen(true)}
        data-record-timeline-composer=""
      >
        <span className="truncate">{t('detail.timelineComposer', { defaultValue: 'Write a note… @ to mention' })}</span>
      </button>
    );

  // The day header over its entries: 今天, 昨天, then the date.
  const dayLabelOf = (createdAt: string | undefined): string => {
    const key = dayKeyOf(createdAt);
    if (!key || !createdAt) return '';
    const now = new Date();
    if (key === dayKeyOf(now.toISOString())) return t('detail.streamToday', { defaultValue: 'Today' });
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (key === dayKeyOf(yesterday.toISOString())) return t('detail.streamYesterday', { defaultValue: 'Yesterday' });
    const date = new Date(createdAt);
    return date.toLocaleDateString(displayLocale, {
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
    });
  };
  const firstItemOf = (entry: ActivityTimelineEntry): FeedItem => (entry.kind === 'fold' ? entry.items[0] : entry.item);
  const renderDays = (): React.ReactNode => {
    const days: { key: string; label: string; entries: ActivityTimelineEntry[] }[] = [];
    for (const entry of timelineEntries) {
      const createdAt = firstItemOf(entry).createdAt;
      const key = dayKeyOf(createdAt);
      const last = days[days.length - 1];
      if (last && last.key === key) last.entries.push(entry);
      else days.push({ key, label: dayLabelOf(createdAt), entries: [entry] });
    }
    return (
      <div data-stream-list="">
        {days.map((day, index) => (
          <div key={`${day.key}:${index}`} data-stream-day={day.key}>
            {day.label && (
              <div className="pb-0.5 pt-2 text-xs font-medium text-muted-foreground" data-stream-day-label="">
                {day.label}
              </div>
            )}
            {day.entries.map((entry) => (entry.kind === 'fold' ? renderFold(entry) : renderItem(entry.item)))}
          </div>
        ))}
      </div>
    );
  };

  // objectstack#27524, Target 5 — the 动态 panel's body. The panel around it
  // draws the header (「动态」 and the count); here: the composer, one line
  // until pressed, then the entries this block was handed (the newest, roots
  // only) as one line each — what, then when — and 「查看全部 N 条 →」 to the
  // 动态 tab when the stream holds more than are drawn.
  if (isPeek) {
    const total = totalCount ?? filtered.length;
    const peekLine = (item: FeedItem): React.ReactNode => {
      const Icon = item.type === 'comment' ? MessageSquare : isSystemStreamEntry(item) ? Edit : FEED_TYPE_ICONS[item.type] || Zap;
      const body = (item.body ?? '').replace(/\s+/g, ' ').trim();
      const what = isSystemStreamEntry(item) ? systemLineText(item) : body || item.actor;
      const when = formatTimestamp(item.createdAt, t, displayLocale);
      return (
        <div
          key={item.id}
          className="flex h-8 items-center gap-2 border-t border-border px-3 text-[12.5px]"
          title={`${what} · ${item.actor} · ${when}`}
          data-record-timeline-peek-row=""
        >
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{what}</span>
          {/* Every row says who (objectstack#30122). */}
          <span className="max-w-[40%] shrink-0 truncate text-[11.5px] text-muted-foreground" data-record-timeline-peek-actor="">
            {item.actor}
          </span>
          <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">{when}</span>
        </div>
      );
    };
    return (
      <div className={className} data-record-timeline-peek="">
        {showCommentInput && (
          <div className="border-t border-border px-3 py-2">
            {composerLine}
          </div>
        )}
        {filtered.length > 0 && readNotice && <div className="border-t border-border px-3">{readNotice}</div>}
        {loading && filtered.length === 0 ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="activity-loading"
            className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{t('detail.loading')}</span>
          </div>
        ) : readUnanswered && filtered.length === 0 ? (
          <div className="border-t border-border px-3">{readNotice}</div>
        ) : filtered.length === 0 ? (
          <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {emptyLabel ?? t('detail.noActivity')}
          </div>
        ) : (
          rootItems.map(peekLine)
        )}
        {onViewAll && total > rootItems.length && (
          <button
            type="button"
            className="flex h-8 w-full items-center border-t border-border px-3 text-left text-[12.5px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={onViewAll}
            data-record-timeline-view-all=""
          >
            {t('detail.viewAllEntries', { count: total, defaultValue: 'View all {{count}} →' })}
          </button>
        )}
      </div>
    );
  }

  return (
    <section
      // De-boxed: render as a naked section with a top divider instead of
      // the previous bordered Card. This keeps the discussion panel
      // visually consistent with the rest of the record-detail page
      // (highlights + tabs are also naked). When the chatter panel is
      // pinned to the right rail it wraps this with its own border, so
      // we don't double up.
      className={cn(
        'border-t border-border/60 pt-3',
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
      <header className="mb-2">
        {/* Wraps: in a 320 px foot card the stream's chips go under the title
            rather than past the card's edge (objectstack#27055). */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold leading-none tracking-tight">
            <Activity className="h-4 w-4" />
            {title}
            {/* A refused read leaves the count unknown, not zero: the rows
                the reader may not see are not in `filtered`, so a number here
                would state what the server withheld. */}
            {!readUnanswered && (
              <span className="text-sm font-normal text-muted-foreground" data-testid="activity-count">
                ({filtered.length})
              </span>
            )}
          </h2>
          <div className="flex items-center gap-1">
            {isStream && (
              <div
                role="group"
                aria-label={t('detail.filterActivity')}
                className="flex flex-wrap items-center gap-1"
                data-stream-filters=""
              >
                {streamFilters.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    aria-pressed={streamFilter === chip}
                    onClick={() => onStreamFilterChange?.(chip)}
                    data-stream-filter={chip}
                    className={cn(
                      'h-11 min-w-11 sm:h-6 sm:min-w-0 rounded-md px-2 text-xs font-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      streamFilter === chip ? 'bg-primary/10 text-primary' : 'bg-muted text-foreground hover:bg-muted/70',
                    )}
                  >
                    {t(STREAM_FILTER_KEYS[chip].key, { defaultValue: STREAM_FILTER_KEYS[chip].fallback })}
                  </button>
                ))}
              </div>
            )}
            {/* The filter: a quiet text button at the right of the title
                row (「全部动态 ▾」) — the stream has its chips instead. */}
            {showFilter && !isStream && (
              <Select
                value={activeFilter}
                onValueChange={(v) => handleFilterChange(v as FeedFilterMode)}
              >
                <SelectTrigger
                  aria-label={t('detail.filterActivity')}
                  className="h-11 sm:h-7 w-auto gap-1 border-0 bg-transparent px-1.5 py-0 text-xs text-muted-foreground shadow-none hover:text-foreground"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {filterOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {showSubscription && subscription && (
              <SubscriptionToggle
                subscription={subscription}
                onToggle={onToggleSubscription}
              />
            )}
          </div>
        </div>
      </header>
      <div className="space-y-2">
        {/* Comment Input — rich text with @mention + bold/italic/list/code + preview */}
        {showCommentInput && composer}

        {/* A refusal with rows on screen (objectui#11195): the comments
            were readable and the activity was not, or the other way round.
            The rows stay, and the notice above them says which half the
            reader may not see. Without it the rows would read as the whole
            story. With no rows, the notice is the branch below instead. */}
        {filtered.length > 0 && readNotice}

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
        ) : readUnanswered && filtered.length === 0 ? (
          // objectui#11195: a REFUSED read is not an empty one. This branch
          // comes before the empty state because "you may not see this" and
          // "there is nothing here" are different answers, and only the first
          // is true when the server refused the read. The empty state's copy
          // is a claim about the record, and a refusal gives no evidence for
          // it. Only the i18n sentence is rendered: no status code, no server
          // message, no object name. objectstack#29188: a FAILED read (5xx,
          // network) is not an empty one either, for the same reason; it
          // says the read failed and offers a Retry.
          readNotice
        ) : filtered.length === 0 ? (
          collapseWhenEmpty ? null : (
            <DataEmptyState
              title={emptyLabel ?? t('detail.noActivity')}
              className="py-6"
            />
          )
        ) : (
          renderDays()
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
              data-stream-load-more={isStream ? '' : undefined}
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
