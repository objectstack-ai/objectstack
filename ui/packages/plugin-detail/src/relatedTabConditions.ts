/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What a reader changed on a record page's related tab (objectstack#35892):
 * its sort, its filter and the footer's calculations. Temporary by the card's
 * rule: it holds while the reader stays on the record (switching tabs, or
 * between the record's page and its drawer, keeps it), and it is gone after a
 * reload or on another record. 「Discard」 clears it. Nothing is written
 * anywhere: the tab has no Save.
 *
 * Held in module memory rather than in the tab's React state because the
 * record page unmounts a tab's face when another tab opens. One record's tabs
 * at a time: claiming the tabs of another record drops the last record's.
 */

import * as React from 'react';
import type { FilterBuilderRowGroup, SortItem } from '@object-ui/components';
import type { ColumnSummary } from '@objectstack/spec/ui';

export interface RelatedTabConditions {
  /** The reader's sort levels; empty = the list's default order. */
  sort: SortItem[];
  /** The filter group the condition row edits. */
  filters: FilterBuilderRowGroup;
  /** The filter it applies, as the query node (`undefined` = none). */
  filterNode: unknown[] | undefined;
  /** Footer calculations the reader picked, by field (`null` = None). */
  summaries: Readonly<Record<string, ColumnSummary | null>>;
}

export const EMPTY_RELATED_TAB_CONDITIONS: RelatedTabConditions = Object.freeze({
  sort: [],
  filters: { id: 'root', logic: 'and', conditions: [] },
  filterNode: undefined,
  summaries: Object.freeze({}),
}) as RelatedTabConditions;

/** Whether the reader changed anything on the tab: what lights 「Discard」. */
export function relatedTabConditionsChanged(conditions: RelatedTabConditions): boolean {
  return conditions.sort.length > 0
    || conditions.filterNode !== undefined
    || Object.keys(conditions.summaries).length > 0;
}

let heldRecord: string | null = null;
const held = new Map<string, RelatedTabConditions>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The key of one record's tab: the record (`object:id`) and the relationship the list hangs on. */
export function relatedTabKey(record: string, relationship: string): string {
  return `${record}\u0000${relationship}`;
}

/** Start holding `record`'s tabs; another record's are dropped. */
function claimRecord(record: string): void {
  if (heldRecord === record) return;
  heldRecord = record;
  if (held.size > 0) held.clear();
}

/** The tab's conditions, held for this record; the empty set before any change. */
export function readRelatedTabConditions(record: string, relationship: string): RelatedTabConditions {
  if (heldRecord !== record) return EMPTY_RELATED_TAB_CONDITIONS;
  return held.get(relatedTabKey(record, relationship)) ?? EMPTY_RELATED_TAB_CONDITIONS;
}

/** Lay `patch` over the tab's conditions. */
export function patchRelatedTabConditions(
  record: string,
  relationship: string,
  patch: Partial<RelatedTabConditions>,
): void {
  claimRecord(record);
  const key = relatedTabKey(record, relationship);
  const next = { ...(held.get(key) ?? EMPTY_RELATED_TAB_CONDITIONS), ...patch };
  if (relatedTabConditionsChanged(next)) held.set(key, next);
  else held.delete(key);
  notify();
}

/** 「Discard」: the tab back to its default. */
export function discardRelatedTabConditions(record: string, relationship: string): void {
  if (heldRecord !== record || !held.delete(relatedTabKey(record, relationship))) return;
  notify();
}

/** For tests: forget every record's tabs. */
export function resetRelatedTabConditionsForTests(): void {
  heldRecord = null;
  held.clear();
  notify();
}

/**
 * The tab's conditions and their writers. `record` / `relationship` null ⇒
 * not a tab (the empty set, writers that do nothing). Opening a tab of
 * another record drops the last record's tabs.
 */
export function useRelatedTabConditions(record: string | null, relationship: string | null): {
  conditions: RelatedTabConditions;
  patch: (patch: Partial<RelatedTabConditions>) => void;
  discard: () => void;
} {
  React.useEffect(() => {
    if (record && relationship && heldRecord !== record) {
      claimRecord(record);
      notify();
    }
  }, [record, relationship]);
  const conditions = React.useSyncExternalStore(
    subscribe,
    () => (record && relationship ? readRelatedTabConditions(record, relationship) : EMPTY_RELATED_TAB_CONDITIONS),
    () => EMPTY_RELATED_TAB_CONDITIONS,
  );
  const patch = React.useCallback(
    (next: Partial<RelatedTabConditions>) => {
      if (record && relationship) patchRelatedTabConditions(record, relationship, next);
    },
    [record, relationship],
  );
  const discard = React.useCallback(() => {
    if (record && relationship) discardRelatedTabConditions(record, relationship);
  }, [record, relationship]);
  return { conditions, patch, discard };
}
