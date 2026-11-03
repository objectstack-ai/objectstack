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
 * rows as feed items, the merge (newest first, an update counted once), and
 * the four filter chips 全部 / 活动 / 讨论 / 变更.
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
  changes?: Array<{ field: string; label?: string; from?: unknown; to?: unknown }>;
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
    } as FeedItem);
  }
  return out;
}

const timeOf = (item: FeedItem): number => {
  const t = Date.parse(item.createdAt);
  return Number.isFinite(t) ? t : 0;
};

/**
 * The one stream: the host's discussion + activity items and the field
 * changes, newest first. With field changes present, the activity stream's
 * own `updated` rows step aside — the audit entry says the same update with
 * its before and after values, and an update is counted once.
 */
export function mergeTimelineStream(
  feed: readonly FeedItem[] | null | undefined,
  fieldChanges: readonly FeedItem[] | null | undefined,
): FeedItem[] {
  const changes = fieldChanges ?? [];
  const base = (feed ?? []).filter(
    (item) => !(changes.length > 0 && (item as { activityType?: string }).activityType === RECORD_TIMELINE_UPDATE_ACTIVITY_TYPE),
  );
  return [...base, ...changes]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => timeOf(b.item) - timeOf(a.item) || a.index - b.index)
    .map(({ item }) => item);
}

/** The stream's filter chips: 全部 / 活动 / 讨论 / 变更. */
export type TimelineStreamFilter = 'all' | 'activity' | 'discussion' | 'changes';

export const TIMELINE_STREAM_FILTERS: readonly TimelineStreamFilter[] = ['all', 'activity', 'discussion', 'changes'];

/** Whether an item is a system entry — drawn as one compact muted line. */
export function isSystemStreamEntry(item: FeedItem): boolean {
  return item.type === 'field_change' || item.type === 'system';
}

/** The items a chip shows: discussion = comments; changes = field changes; activity = the rest. */
export function filterTimelineStream(items: readonly FeedItem[], filter: TimelineStreamFilter): FeedItem[] {
  switch (filter) {
    case 'discussion':
      return items.filter((item) => item.type === 'comment');
    case 'changes':
      return items.filter((item) => item.type === 'field_change');
    case 'activity':
      return items.filter((item) => item.type !== 'comment' && item.type !== 'field_change');
    default:
      return [...items];
  }
}
