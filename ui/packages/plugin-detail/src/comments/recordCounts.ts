/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36423 — how many open comment threads and how many attachments
 * each of MANY records has, for a surface that draws many records at once (a
 * kanban board's cards, `kanban.cardFooter`). The record page counts one record's threads off the
 * feed it already holds (`unresolvedThreadCount`); a board cannot read a feed
 * per card, so it asks ONE grouped read per counted object over the records it
 * has loaded, never one read per record.
 *
 * - Comments: `sys_comment` rows of the object whose `record_id` is one of the
 *   records, top-level (`parent_id` empty) and not resolved (`is_resolved` not
 *   `true`; a deployment that stores no resolution leaves it empty, and every
 *   thread counts), grouped by `record_id`. This is the record page's number
 *   (`unresolvedThreadCount`) as the server can group it: a reply whose parent
 *   was deleted is a thread of its own on the record page and is not counted
 *   here.
 * - Attachments: `sys_attachment` rows whose `parent_object` is the object and
 *   whose `parent_id` is one of the records, grouped by `parent_id`. Only an
 *   object with `enable.files` has any.
 *
 * - Both count rows by the stamped pair (`object_name` + `record_id`,
 *   `parent_object` + `parent_id`), the indexed key each read gate narrows by.
 *   The record page reads a record's comments by `thread_id`, so a comment
 *   written before the pair existed is counted there and not here until
 *   `os migrate comment-parent-pair --apply` has stamped it.
 *
 * Both ride the existing grouped door (`DataSource.queryGroupHeaders`, `POST
 * /data/:object/query`), as the reader: each source's access hooks judge the
 * aggregate as they judge a read. A refused or failed read draws no count.
 *
 * A cut answer (`hasMore`: the door cut the groups to the deployment's default
 * page size, `OS_DATA_DEFAULT_PAGE_SIZE`) is never read as the whole set: a
 * record it does not name may have rows. The records it names keep their
 * exact count, and the reader asks again over the records it did not name,
 * still ONE grouped read per round, until an answer is whole
 * (`askRecordCounts`). A record still unnamed when the rounds stop (an answer
 * that names none of them, or `MAX_COUNT_ROUNDS`) has no count, never a zero.
 *
 * The counts are asked again when the surface reloads (`reloadKey`) and when a
 * write to a counted object is announced on the data-invalidation bus (a
 * comment posted or resolved, an attachment uploaded or deleted, in the record
 * drawer a card opens).
 */

import * as React from 'react';
import type { DataSource } from '@object-ui/types';
import { useDataInvalidation } from '@object-ui/react';

/** The object that holds a record's comments. */
export const COMMENT_COUNT_OBJECT = 'sys_comment';
/** The object that holds a record's attachments. */
export const ATTACHMENT_COUNT_OBJECT = 'sys_attachment';
/** The column a count read answers each record's count under. */
export const RECORD_COUNT_ALIAS = 'count';

/** What `DataSource.queryGroupHeaders` takes. */
export type RecordCountQuery = Parameters<NonNullable<DataSource['queryGroupHeaders']>>[1];

/** Each record's count, by record id. A record with none is absent. */
export type RecordCounts = Readonly<Record<string, number>>;

/** The distinct, non-empty record ids, in a stable order (the read's key). */
export function recordCountIds(ids: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    if (typeof id === 'string' ? id !== '' : typeof id === 'number' && Number.isFinite(id)) out.add(String(id));
  }
  return [...out].sort();
}

/** The open-thread count read of `objectName`'s records `ids` (see the header). */
export function compileCommentCountQuery(objectName: string, ids: readonly string[]): RecordCountQuery {
  return {
    where: {
      object_name: objectName,
      record_id: { $in: [...ids] },
      parent_id: null,
      is_resolved: { $ne: true },
    },
    groupBy: ['record_id'],
    aggregations: [{ function: 'count', alias: RECORD_COUNT_ALIAS }],
  } as RecordCountQuery;
}

/** The attachment count read of `objectName`'s records `ids` (see the header). */
export function compileAttachmentCountQuery(objectName: string, ids: readonly string[]): RecordCountQuery {
  return {
    where: {
      parent_object: objectName,
      parent_id: { $in: [...ids] },
    },
    groupBy: ['parent_id'],
    aggregations: [{ function: 'count', alias: RECORD_COUNT_ALIAS }],
  } as RecordCountQuery;
}

/**
 * Each record's count off a count read's answer, keyed by `keyField` (the
 * read's `groupBy`), or `null` when the answer is not a list of rows. Only the
 * asked records are kept, and a count that is not a whole positive number is
 * dropped.
 */
export function readRecordCounts(answer: unknown, keyField: string, ids: readonly string[]): Record<string, number> | null {
  if (!Array.isArray(answer)) return null;
  const asked = new Set(ids);
  const counts: Record<string, number> = Object.create(null);
  for (const row of answer) {
    if (!row || typeof row !== 'object') continue;
    const key = (row as Record<string, unknown>)[keyField];
    if (key === null || key === undefined) continue;
    const id = String(key);
    if (!asked.has(id)) continue;
    const raw = (row as Record<string, unknown>)[RECORD_COUNT_ALIAS];
    const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) continue;
    counts[id] = value;
  }
  return counts;
}

/** The records an answer names (its rows' `keyField`), among `ids`. */
function namedRecordIds(answer: readonly unknown[], keyField: string, ids: readonly string[]): Set<string> {
  const asked = new Set(ids);
  const named = new Set<string>();
  for (const row of answer) {
    if (!row || typeof row !== 'object') continue;
    const key = (row as Record<string, unknown>)[keyField];
    if (key === null || key === undefined) continue;
    if (asked.has(String(key))) named.add(String(key));
  }
  return named;
}

/**
 * The most grouped reads one count takes over a cut answer before the records
 * it has not named are left without a count (see the header).
 */
export const MAX_COUNT_ROUNDS = 20;

/**
 * Each of `objectName`'s records `ids`' count of `source` (`sys_comment` or
 * `sys_attachment`), or `null` when the first answer is not a list of rows.
 * One grouped read when the answer is whole; over a cut answer (`hasMore`),
 * one more over the records it did not name, until an answer is whole, names
 * none of them, or `MAX_COUNT_ROUNDS` is reached. A refused read throws.
 */
export async function askRecordCounts(
  dataSource: Pick<DataSource, 'queryGroupHeaders'>,
  source: string,
  objectName: string,
  ids: readonly string[],
): Promise<Record<string, number> | null> {
  const comment = source === COMMENT_COUNT_OBJECT;
  const keyField = comment ? 'record_id' : 'parent_id';
  const counts: Record<string, number> = Object.create(null);
  let remaining = [...ids];
  for (let round = 0; remaining.length > 0 && round < MAX_COUNT_ROUNDS; round++) {
    const query = comment ? compileCommentCountQuery(objectName, remaining) : compileAttachmentCountQuery(objectName, remaining);
    const answer = await dataSource.queryGroupHeaders!(source, query);
    // `hasMore` rides ON the array: read it off the answer as returned.
    const cut = Array.isArray(answer) && (answer as { hasMore?: unknown }).hasMore === true;
    const read = readRecordCounts(answer, keyField, remaining);
    if (read === null) return round === 0 ? null : counts;
    Object.assign(counts, read);
    if (!cut) break;
    const named = namedRecordIds(answer as readonly unknown[], keyField, remaining);
    if (named.size === 0) break;
    remaining = remaining.filter((id) => !named.has(id));
  }
  return counts;
}

export interface RecordCountsInput {
  dataSource: DataSource | null | undefined;
  objectName: string | undefined;
  /** The records drawn (their ids). */
  recordIds: readonly unknown[];
  /** Ask the open comment threads. */
  comments: boolean;
  /** Ask the attachments. */
  attachments: boolean;
  /** Changes when the surface reloads, so the counts are asked again. */
  reloadKey?: unknown;
}

export interface RecordCountsData {
  /** Each record's open comment threads; `null` when not asked, not answered yet, or refused. */
  comments: RecordCounts | null;
  /** Each record's attachments; `null` when not asked, not answered yet, or refused. */
  attachments: RecordCounts | null;
}

type Held = { scope: string; question: string; counts: Record<string, number> | null };

/**
 * The comment and attachment counts of the records drawn: one grouped read per
 * counted object for the whole set (more only over a cut answer, see
 * `askRecordCounts`), asked again when the set, the object or `reloadKey`
 * changes, or when a write to the counted object is announced on the
 * data-invalidation bus. Nothing is read for a count not asked, for no
 * records, or over a data source that cannot answer a grouped read.
 */
export function useRecordCounts(input: RecordCountsInput): RecordCountsData {
  const { dataSource, objectName, recordIds, comments, attachments, reloadKey } = input;
  const ids = recordCountIds(recordIds);
  const idsKey = JSON.stringify(ids);
  const canAsk = !!objectName && ids.length > 0 && typeof dataSource?.queryGroupHeaders === 'function';
  const askComments = canAsk && comments;
  const askAttachments = canAsk && attachments;
  const commentQuestion = askComments ? JSON.stringify([COMMENT_COUNT_OBJECT, objectName, idsKey]) : '';
  const attachmentQuestion = askAttachments ? JSON.stringify([ATTACHMENT_COUNT_OBJECT, objectName, idsKey]) : '';
  // A write to the counted object (any of its rows) moves the count.
  const commentWrites = useDataInvalidation(askComments ? COMMENT_COUNT_OBJECT : undefined);
  const attachmentWrites = useDataInvalidation(askAttachments ? ATTACHMENT_COUNT_OBJECT : undefined);

  const commentCounts = useCountRead(dataSource, commentQuestion, reloadKey, commentWrites);
  const attachmentCounts = useCountRead(dataSource, attachmentQuestion, reloadKey, attachmentWrites);
  return { comments: commentCounts, attachments: attachmentCounts };
}

function useCountRead(
  dataSource: DataSource | null | undefined,
  question: string,
  reloadKey: unknown,
  writes: number,
): Record<string, number> | null {
  const [held, setHeld] = React.useState<Held | null>(null);
  React.useEffect(() => {
    if (!question || typeof dataSource?.queryGroupHeaders !== 'function') return;
    let cancelled = false;
    const [source, objectName, idsKey] = JSON.parse(question) as [string, string, string];
    const ids = JSON.parse(idsKey) as string[];
    const scope = JSON.stringify([source, objectName]);
    // Nothing is cleared before the answer lands: asking again (a reload, a
    // write, a record moved) keeps the counts on screen until the new ones.
    Promise.resolve()
      .then(() => askRecordCounts(dataSource, source, objectName, ids))
      .then(
        (counts) => {
          if (!cancelled) setHeld({ scope, question, counts });
        },
        () => {
          if (!cancelled) setHeld({ scope, question, counts: null });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [dataSource, question, reloadKey, writes]);
  return React.useMemo(() => {
    if (!question || !held) return null;
    if (held.question === question) return held.counts;
    // Another set of the same object's records (a lane's next page, a card
    // created): the counts of the records in both sets stay drawn until the
    // new answer, so no foot blinks. Another object's counts, or a count no
    // longer asked, are never drawn.
    const [source, objectName, idsKey] = JSON.parse(question) as [string, string, string];
    if (held.scope !== JSON.stringify([source, objectName]) || held.counts === null) return null;
    const kept: Record<string, number> = Object.create(null);
    for (const id of JSON.parse(idsKey) as string[]) {
      if (held.counts[id] !== undefined) kept[id] = held.counts[id];
    }
    return kept;
  }, [question, held]);
}
