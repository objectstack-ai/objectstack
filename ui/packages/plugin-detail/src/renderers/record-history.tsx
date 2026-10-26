/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:history` — renders an audit-log timeline for the current record.
 * Thin wrapper around `<HistoryTimeline>`.
 *
 * Data model: a host MAY pass `entries` (array of history rows) + `loading`
 * directly (RecordDetailView's synthesizer path does this). When no host
 * entries are supplied — e.g. the block is hand-authored inside a `page:tabs`
 * on a custom record page — the renderer SELF-FETCHES from `sys_activity`
 * (the same source the discussion/activity feed reads), scoped to the current
 * record via `useRecordContext`. This makes `record:history` drop-anywhere,
 * matching `record:related_list`'s self-fetch behaviour, instead of silently
 * showing "No history yet".
 */

import React from 'react';
import { useRecordContext } from '@object-ui/react';
import { HistoryTimeline, type HistoryEntry } from '../HistoryTimeline';
import { activityActorName } from './recordActivityFeed';

const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style, ...rest } = props || {};
  return { designer: { 'data-obj-id': id, 'data-obj-type': type, style }, rest };
};

export interface RecordHistoryRendererProps {
  schema?: {
    entries?: HistoryEntry[];
    loading?: boolean;
    emptyText?: string;
    unknownUserText?: string;
    limit?: number;
    properties?: Record<string, any>;
    [k: string]: any;
  };
  className?: string;
  [k: string]: any;
}

/**
 * The acting user's id on a `sys_activity` row, or `null` when the row names
 * no actor. `actor_id` is the bare id, or the user's record once `$expand`
 * put it in place (objectui#12067); either way only the id is kept.
 */
function activityActorId(row: { actor_id?: unknown }): string | number | null {
  const actor = row?.actor_id;
  if (typeof actor === 'string' || typeof actor === 'number') return actor;
  if (actor && typeof actor === 'object') {
    const id = (actor as { id?: unknown }).id;
    if (typeof id === 'string' || typeof id === 'number') return id;
  }
  return null;
}

/** sys_activity row → HistoryEntry. Only field-mutating activity types map to
 *  history (comments/mentions/logins are not record-history). */
const HISTORY_TYPES = new Set(['created', 'updated', 'assigned', 'shared', 'deleted']);

/**
 * Rows this block shows when the author declared no usable cap.
 *
 * Named because `50` was spelled TWICE in the old derivation (`?? 50` and the
 * `|| 50` behind it), and the spec states the same number a third time:
 * `RecordHistoryProps.limit` is described there as "Maximum history entries
 * displayed, and the `$top` of the self-fetch query (renderer default: 50)".
 *
 * ⛔ Deliberately NOT `record:activity`'s 20. The two blocks default
 * differently on purpose; unifying them is a product decision and objectui#10005
 * is not it.
 */
const DEFAULT_HISTORY_LIMIT = 50;

/**
 * What the contract admits as this block's row cap: a positive integer NUMBER.
 *
 * `@objectstack/spec` declares the member `z.number().int().positive()`
 * (`RecordHistoryProps.limit`, `.optional()`). `z.number()` refuses every
 * non-number outright, so a numeric STRING (`'5'`, `' 5 '`, `'0x10'`), a boolean
 * and an array are values the contract REFUSES, not spellings this renderer may
 * read (objectui#10145, ruled STOP). ⛔ No `Number(value)` in front of this
 * check: that coercion admitted a second accepted set wider than the
 * declaration (AGENTS.md #0.1).
 *
 * The predicate lives ONCE, here; the resolver and the diagnostic both read it.
 */
function isUsableHistoryLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * The ONE resolver for this block's row cap (objectui#10005, objectui#10145).
 *
 * A refused value is dropped for this block's own default.
 *
 * ⛔ Not `Math.max(1, …)`, which objectui#10005 replaced: that REPAIRED a
 * refused `-5` into a one-row window and forwarded a fractional `2.5` to the
 * adapter untouched. Refusing and defaulting is the answer the sibling
 * `record:activity` gives through `normalizeLimit`, and the answer
 * objectui#9925 landed at three further read points.
 *
 * ⚠️ FAIL-SOFT on purpose (throwing would take out a record page over one
 * declaration), and NOT silent: the renderer states every refusal through
 * `describeRefusedHistoryLimit` (objectui#10097 ruled "always warn" for the
 * family; objectui#10145 extends the refused set to non-numbers).
 */
function normalizeHistoryLimit(value: unknown): number {
  return isUsableHistoryLimit(value) ? value : DEFAULT_HISTORY_LIMIT;
}

/** Spell an authored value so its TYPE survives: `'5'` must not print as `5`. */
function formatAuthoredLimit(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // fall through to String()
  }
  return String(value);
}

/**
 * The diagnostic half. `null` means "nothing to say": an absent `limit` is not
 * a mistake, and a usable one is not either. Fired from an effect keyed on the
 * message — the channel objectui#9925 uses — never from render.
 */
function describeRefusedHistoryLimit(authored: unknown): string | null {
  if (authored === undefined || authored === null) return null;
  if (isUsableHistoryLimit(authored)) return null;
  return (
    `[ObjectUI] record:history row cap: declared limit: ${formatAuthoredLimit(authored)} `
    + `(${Array.isArray(authored) ? 'array' : typeof authored}), which is not a positive integer number. `
    + 'The spec declares `limit` as z.number().int().positive() and refuses strings, '
    + 'booleans, fractions, zero and negatives, so it was ignored and this block '
    + `fell back to its default row cap (${DEFAULT_HISTORY_LIMIT}).`
  );
}

export const RecordHistoryRenderer: React.FC<RecordHistoryRendererProps> = ({
  schema = {} as any,
  className,
  ...props
}) => {
  const { designer } = splitDesigner(props);
  const ctx = useRecordContext();

  // Spec bridge inlines `properties.*` onto the node but also preserves the raw
  // bag. Read from either location for compatibility.
  const hostEntries: HistoryEntry[] | undefined = Array.isArray(schema.entries)
    ? schema.entries
    : Array.isArray(schema.properties?.entries)
      ? (schema.properties!.entries as HistoryEntry[])
      : undefined;
  const hostLoading = schema.loading ?? schema.properties?.loading;
  const emptyText = schema.emptyText ?? schema.properties?.emptyText;
  const unknownUserText = schema.unknownUserText ?? schema.properties?.unknownUserText;
  const authoredLimit = schema.limit ?? schema.properties?.limit;
  const limit: number = normalizeHistoryLimit(authoredLimit);
  // [objectui#10145] The loud half of the row-cap refusal, on the channel
  // objectui#9925 uses: from an effect, keyed on the message (which spells the
  // authored value and its type), so an unchanged declaration warns once.
  const refusedLimitMessage = describeRefusedHistoryLimit(authoredLimit);
  React.useEffect(() => {
    if (refusedLimitMessage) console.warn(refusedLimitMessage);
  }, [refusedLimitMessage]);

  // Self-fetch only when the host did not supply entries.
  const objectName: string | undefined = ctx?.objectName;
  const recordId = ctx?.data?.id ?? ctx?.data?._id ?? ctx?.recordId;
  const dataSource = ctx?.dataSource;
  const canSelfFetch = hostEntries === undefined && !!dataSource?.find && !!objectName && recordId != null;

  const [fetched, setFetched] = React.useState<HistoryEntry[] | null>(null);
  const [selfLoading, setSelfLoading] = React.useState(false);

  React.useEffect(() => {
    if (!canSelfFetch) return;
    let cancelled = false;
    setSelfLoading(true);
    Promise.resolve(
      dataSource.find('sys_activity', {
        $filter: { object_name: objectName, record_id: recordId },
        $orderby: { timestamp: 'desc' },
        $top: limit,
        // Name the actor on this one read (objectui#12067): the engine
        // batch-loads the page's `sys_user` rows and puts each record in place
        // of its id. `activityActorName` reads it; never a request per row.
        $expand: ['actor_id'],
      }),
    )
      .then((res: any) => {
        if (cancelled) return;
        // `data` is the ONE rows member `QueryResult` (`@object-ui/types`)
        // declares. A `res?.records` arm sat behind it until objectui#6726 — a
        // below-the-adapter spelling (`ObjectStackAdapter.normalizeQueryResult`
        // maps the server/SDK `records` envelope to `data` before returning),
        // so no producer emits it at this `DataSource.find()` seam and the arm
        // was dead. Pinned by `record-history.contractEnvelope-6726.test.tsx`.
        const rows: any[] = res?.data ?? [];
        const mapped: HistoryEntry[] = rows
          .filter((r) => HISTORY_TYPES.has(r?.type))
          .map((r) => {
            let when = r.timestamp;
            if (!when || when === 'NOW()' || Number.isNaN(Date.parse(when))) when = r.created_at;
            return {
              id: r.id,
              created_at: when,
              action: r.type,
              // The id rides along so the timeline can tell a system write
              // (no actor at all) from a user it could not name
              // (objectui#12527). Expanded, `actor_id` is the user's record.
              user_id: activityActorId(r),
              user_name: activityActorName(r),
              user_avatar: r.actor_avatar_url ?? null,
              summary: r.summary ?? null,
            } as HistoryEntry;
          });
        setFetched(mapped);
      })
      .catch(() => { if (!cancelled) setFetched([]); })
      .finally(() => { if (!cancelled) setSelfLoading(false); });
    return () => { cancelled = true; };
  }, [canSelfFetch, dataSource, objectName, recordId, limit]);

  const entries: HistoryEntry[] = hostEntries ?? fetched ?? [];
  const loading = hostLoading ?? (canSelfFetch && fetched === null ? selfLoading || true : false);

  return (
    <div className={className} {...designer}>
      <HistoryTimeline entries={entries} loading={loading} emptyText={emptyText} unknownUserText={unknownUserText} />
    </div>
  );
};

export default RecordHistoryRenderer;
