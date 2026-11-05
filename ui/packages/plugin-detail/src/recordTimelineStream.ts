/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The record page's 动态 stream: ONE stream (objectstack#27055, Target 3),
 * drawn as the first panel of the right column and in full in the 动态 tab
 * (objectstack#27524, Target 5).
 *
 * Three sources, one stream: the discussion (`sys_comment`, `enable.feeds`),
 * the activity (`sys_activity`, `enable.activities`) — both already merged by
 * the host's `DiscussionContext` — and the field changes (`sys_audit_log`,
 * `trackHistory`), which the host hands over through
 * {@link RecordFieldChangesContext}. This module is the pure part: the audit
 * rows as feed items, the merge (newest first, one action one row), and
 * the four filter chips 全部 / 活动 / 讨论 / 变更 (变更 = the audit's field
 * changes; every activity row is 活动).
 */

import * as React from 'react';
import { RECORD_TIMELINE_UPDATE_ACTIVITY_TYPE } from '@objectstack/spec/api';
import type { FeedItem } from '@object-ui/types';

/**
 * The record's field changes as feed items, from the host's audit read —
 * `null` while the host has none to give (no `trackHistory`, an authored
 * page, a read not made). Read by the timeline stream on the default record
 * page only.
 */
export const RecordFieldChangesContext = React.createContext<FeedItem[] | null>(null);

/**
 * The 动态 panel being drawn (objectstack#27524, Target 5): the first panel
 * of the record page's right column. The stream drawn inside it takes its
 * peek face — the one-line composer, the newest `entries` and
 * 「查看全部 N 条 →」 (`onViewAll`, the 动态 tab) — and reports how many
 * entries the whole stream holds (`onCount`, `null` while unknown) for the
 * panel's count chip. `null` anywhere else: the stream draws in full.
 */
export interface RecordTimelinePanel {
  /** How many of the newest entries the panel shows: 3, or 5 when wide. */
  entries: number;
  onViewAll?: () => void;
  onCount: (count: number | null) => void;
}

export const RecordTimelinePanelContext = React.createContext<RecordTimelinePanel | null>(null);

/** The most entries the 动态 panel shows (its wide face); 3 when narrow. */
export const RECORD_TIMELINE_PANEL_MAX_ENTRIES = 5;

/**
 * The whole 动态 stream's size as the host counts it (objectstack#28737): the
 * record page payload's `timeline` count, kept current by the host across its
 * own comment writes. The host then holds only the newest of the stream's
 * activity, so the count its rows would give is not the stream's: the panel's
 * count chip, its 「查看全部 N 条」, the 动态 tab's count and the tab row's
 * probe all name this one instead. `null` (no host count, or not yet
 * answered): each counts the stream it holds, as before.
 */
export const RecordTimelineTotalContext = React.createContext<number | null>(null);

/**
 * Where the 动态 stream drawn in full — the 动态 tab — reports how many
 * entries it holds, for the tab's count chip on the record page's tab row
 * (objectstack#27524, Target 8). Reported while the 全部 chip is on, the
 * whole stream; `null` while unknown. `null` anywhere else: nothing reports.
 */
export const RecordTimelineCountContext = React.createContext<((count: number | null) => void) | null>(null);

/** One audit-log entry as the host enriches it (`RecordDetailView`'s history read). */
export interface AuditEntryLike {
  id?: string | number;
  created_at?: string | number | Date;
  action?: string;
  user_name?: string | null;
  user_avatar?: string | null;
  summary?: string | null;
  /** Who wrote the entry, as `sys_audit_log.user_id`: the same id `sys_activity.actor_id` holds. */
  user_id?: string | number | null;
  changes?: Array<{ field: string; label?: string; from?: unknown; to?: unknown }>;
}

/**
 * What an audit feed item carries beyond {@link FeedItem}, for the pairing in
 * {@link mergeTimelineStream} (objectstack#30122): the ledger's `action` and
 * its `user_id`. Package-local: written by {@link auditEntriesToFeedItems},
 * read here, never authored.
 */
interface AuditFeedFacts {
  auditAction?: string;
  auditUserId?: string | number | null;
}

/**
 * A stream item as {@link mergeTimelineStream} hands it on: an activity row
 * that one action also wrote to the audit log carries that audit item as
 * `fieldHistory`, so the action reads as ONE row with its before and after
 * values (objectstack#30122). Package-local hand-off, never authored.
 */
export type TimelineStreamItem = FeedItem & { fieldHistory?: FeedItem };

/** The audit item paired onto an activity row, if any. */
export function fieldHistoryOf(item: FeedItem): FeedItem | undefined {
  return (item as TimelineStreamItem).fieldHistory;
}

const displayOf = (value: unknown): string | undefined =>
  value === null || value === undefined || value === '' ? undefined : String(value);

/**
 * Audit entries as `field_change` feed items. Only an entry that changed a
 * field becomes one: the record's creation is the activity stream's own
 * `created` row, so it is not said twice.
 */
export function auditEntriesToFeedItems(
  entries: readonly AuditEntryLike[] | null | undefined,
  labels: { unknownUser: string },
): FeedItem[] {
  const out: FeedItem[] = [];
  for (const entry of entries ?? []) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    if (changes.length === 0) continue;
    const at = entry.created_at instanceof Date ? entry.created_at.toISOString() : entry.created_at;
    out.push({
      id: `audit:${entry.id ?? out.length}`,
      type: 'field_change',
      actor: entry.user_name || labels.unknownUser,
      ...(entry.user_avatar ? { actorAvatarUrl: entry.user_avatar } : {}),
      body: entry.summary ?? '',
      createdAt: at == null ? '' : String(at),
      fieldChanges: changes.map((change) => ({
        field: change.field,
        fieldLabel: change.label ?? change.field,
        oldValue: change.from,
        newValue: change.to,
        ...(displayOf(change.from) !== undefined ? { oldDisplayValue: displayOf(change.from) } : {}),
        ...(displayOf(change.to) !== undefined ? { newDisplayValue: displayOf(change.to) } : {}),
      })),
      source: 'sys_audit_log',
      ...(entry.action ? { auditAction: entry.action } : {}),
      auditUserId: entry.user_id ?? null,
    } as FeedItem & AuditFeedFacts);
  }
  return out;
}

const timeOf = (item: FeedItem): number => {
  const t = Date.parse(item.createdAt);
  return Number.isFinite(t) ? t : 0;
};

/**
 * How far apart an activity row and an audit entry may be stamped and still
 * be one action (objectstack#30122). plugin-audit writes both in one call,
 * the audit row first, so they land milliseconds apart; the window allows a
 * driver that keeps whole seconds.
 */
export const TIMELINE_PAIR_WINDOW_MS = 5000;

/** The ledger's write actions and the activity type the same action writes. */
const AUDIT_ACTION_TO_ACTIVITY_TYPE: Readonly<Record<string, string>> = {
  create: 'created',
  update: RECORD_TIMELINE_UPDATE_ACTIVITY_TYPE,
  delete: 'deleted',
};

/** One actor on both sides: the same user id, or, where neither names one, the same name. */
function sameActor(activity: FeedItem, audit: FeedItem & AuditFeedFacts): boolean {
  const activityId = activity.actorId ?? null;
  const auditId = audit.auditUserId ?? null;
  if (activityId !== null && auditId !== null) return String(activityId) === String(auditId);
  if (activityId !== null || auditId !== null) return false;
  return activity.actor === audit.actor;
}

/**
 * The activity row that wrote the same action as `audit`, or -1: same record
 * (the host reads both for this record), the activity type the audit action
 * writes, the same actor, stamped within {@link TIMELINE_PAIR_WINDOW_MS};
 * the nearest in time wins, and a row pairs once.
 */
function pairedActivityIndex(audit: FeedItem & AuditFeedFacts, feed: readonly FeedItem[], taken: ReadonlySet<number>): number {
  const activityType = audit.auditAction ? AUDIT_ACTION_TO_ACTIVITY_TYPE[audit.auditAction] : undefined;
  if (!activityType) return -1;
  const at = timeOf(audit);
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  feed.forEach((item, index) => {
    if (taken.has(index) || item.activityType !== activityType || item.parentId) return;
    if (!sameActor(item, audit)) return;
    const gap = Math.abs(timeOf(item) - at);
    if (gap <= TIMELINE_PAIR_WINDOW_MS && gap < bestGap) {
      best = index;
      bestGap = gap;
    }
  });
  return best;
}

/**
 * The one stream: the host's discussion + activity items and the field
 * changes, newest first. One action that wrote both an activity row and an
 * audit entry reads as ONE row (objectstack#30122): the activity row, with
 * the audit entry as its `fieldHistory`, so it keeps its actor and summary
 * and gains the before and after values. An audit entry no activity row
 * pairs with is its own row, as before; with field changes present, an
 * unpaired `updated` row still steps aside, as before.
 */
export function mergeTimelineStream(
  feed: readonly FeedItem[] | null | undefined,
  fieldChanges: readonly FeedItem[] | null | undefined,
): TimelineStreamItem[] {
  const changes = (fieldChanges ?? []) as ReadonlyArray<FeedItem & AuditFeedFacts>;
  const activity = feed ?? [];
  const taken = new Set<number>();
  const pairs = new Map<number, FeedItem>();
  const unpaired: FeedItem[] = [];
  for (const audit of changes) {
    const index = pairedActivityIndex(audit, activity, taken);
    if (index < 0) {
      unpaired.push(audit);
      continue;
    }
    taken.add(index);
    pairs.set(index, audit);
  }
  const base: TimelineStreamItem[] = [];
  activity.forEach((item, index) => {
    const audit = pairs.get(index);
    if (audit) {
      base.push({ ...item, fieldHistory: audit });
      return;
    }
    if (changes.length > 0 && item.activityType === RECORD_TIMELINE_UPDATE_ACTIVITY_TYPE) return;
    base.push(item);
  });
  return [...base, ...unpaired]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => timeOf(b.item) - timeOf(a.item) || a.index - b.index)
    .map(({ item }) => item);
}

/** The stream's filter chips: 全部 / 活动 / 讨论 / 变更. */
export type TimelineStreamFilter = 'all' | 'activity' | 'discussion' | 'changes';

export const TIMELINE_STREAM_FILTERS: readonly TimelineStreamFilter[] = ['all', 'activity', 'discussion', 'changes'];

/** The chips while the record's field history is not shown: no 变更. */
const TIMELINE_STREAM_FILTERS_WITHOUT_HISTORY: readonly TimelineStreamFilter[] = TIMELINE_STREAM_FILTERS.filter(
  (filter) => filter !== 'changes',
);

/**
 * Whether the record page shows the record's field history (objectstack#30074):
 * the host's `enable.trackHistory` gate, the one that decides whether it reads
 * the audit log for {@link RecordFieldChangesContext}. While it is `false` the
 * stream offers no 变更 chip. No host saying: `true`, every chip draws.
 */
export const RecordFieldHistoryContext = React.createContext<boolean>(true);

/** The stream's chips, given whether the record's field history is shown. */
export function timelineStreamFilters(fieldHistory: boolean): readonly TimelineStreamFilter[] {
  return fieldHistory ? TIMELINE_STREAM_FILTERS : TIMELINE_STREAM_FILTERS_WITHOUT_HISTORY;
}

/** Whether an item is a system entry — drawn as one compact muted line. */
export function isSystemStreamEntry(item: FeedItem): boolean {
  return item.type === 'field_change' || item.type === 'system';
}

/**
 * Whether an item is a field-history entry: a field change with its before and
 * after values, read from the audit log ({@link auditEntriesToFeedItems}
 * stamps `source: 'sys_audit_log'`). The 变更 chip, and the panel's
 * `changes_only`, hold these and nothing else (objectstack#30074, ruling C).
 * An activity row (`created` / `updated` / `deleted` / `assigned` / `shared`)
 * shares the `field_change` presentation but is an event, so it is judged by
 * its source and sits under 活动, whatever the history flag.
 */
export function isFieldHistoryEntry(item: FeedItem): boolean {
  return item.type === 'field_change' && item.source === 'sys_audit_log';
}

/**
 * The field-history entries of a stream, each on its own: an unpaired audit
 * entry as it is, and the audit entry an activity row carries
 * ({@link fieldHistoryOf}). The 变更 chip and the panel's `changes_only`
 * show these (objectstack#30074 ruling C; objectstack#30122).
 */
export function fieldHistoryEntriesOf(items: readonly FeedItem[]): FeedItem[] {
  return items.flatMap((item) => {
    if (isFieldHistoryEntry(item)) return [item];
    const paired = fieldHistoryOf(item);
    return paired ? [paired] : [];
  });
}

/** The items a chip shows: discussion = comments; changes = field-history entries; activity = the rest. */
export function filterTimelineStream(items: readonly FeedItem[], filter: TimelineStreamFilter): FeedItem[] {
  switch (filter) {
    case 'discussion':
      return items.filter((item) => item.type === 'comment');
    case 'changes':
      return fieldHistoryEntriesOf(items);
    case 'activity':
      return items.filter((item) => item.type !== 'comment' && !isFieldHistoryEntry(item));
    default:
      return [...items];
  }
}
