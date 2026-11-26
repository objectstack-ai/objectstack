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
 * Both ride the existing grouped door (`DataSource.queryGroupHeaders`, `POST
 * /data/:object/query`), as the reader: each source's access hooks judge the
 * aggregate as they judge a read. A refused or failed read draws no count. A
 * partial answer (`hasMore`: the door cut the groups) still gives the records
 * it names their exact count; a record it does not name has no count, rather
 * than a zero it may not have.
 */

import * as React from 'react';
import type { DataSource } from '@object-ui/types';

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

type Held = { question: string; counts: Record<string, number> | null };

/**
 * The comment and attachment counts of the records drawn: at most one grouped
 * read per counted object for the whole set, asked again when the set, the
 * object or `reloadKey` changes. Nothing is read for a count not asked, for no
 * records, or over a data source that cannot answer a grouped read.
 */
export function useRecordCounts(input: RecordCountsInput): RecordCountsData {
  const { dataSource, objectName, recordIds, comments, attachments, reloadKey } = input;
  const ids = recordCountIds(recordIds);
  const idsKey = JSON.stringify(ids);
  const canAsk = !!objectName && ids.length > 0 && typeof dataSource?.queryGroupHeaders === 'function';
  const commentQuestion = canAsk && comments ? JSON.stringify([COMMENT_COUNT_OBJECT, objectName, idsKey]) : '';
  const attachmentQuestion = canAsk && attachments ? JSON.stringify([ATTACHMENT_COUNT_OBJECT, objectName, idsKey]) : '';

  const commentCounts = useCountRead(dataSource, commentQuestion, reloadKey);
  const attachmentCounts = useCountRead(dataSource, attachmentQuestion, reloadKey);
  return { comments: commentCounts, attachments: attachmentCounts };
}

function useCountRead(
  dataSource: DataSource | null | undefined,
  question: string,
  reloadKey: unknown,
): Record<string, number> | null {
  const [held, setHeld] = React.useState<Held | null>(null);
  React.useEffect(() => {
    if (!question || typeof dataSource?.queryGroupHeaders !== 'function') return;
    let cancelled = false;
    const [source, objectName, idsKey] = JSON.parse(question) as [string, string, string];
    const ids = JSON.parse(idsKey) as string[];
    const comment = source === COMMENT_COUNT_OBJECT;
    const query = comment ? compileCommentCountQuery(objectName, ids) : compileAttachmentCountQuery(objectName, ids);
    const keyField = comment ? 'record_id' : 'parent_id';
    // Nothing is cleared before the answer lands: asking again (a reload, a
    // record moved) keeps the counts on screen until the new ones.
    Promise.resolve()
      .then(() => dataSource.queryGroupHeaders!(source, query))
      .then(
        (rows) => {
          if (!cancelled) setHeld({ question, counts: readRecordCounts(rows, keyField, ids) });
        },
        () => {
          if (!cancelled) setHeld({ question, counts: null });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [dataSource, question, reloadKey]);
  // Read in the render the question changes: counts of another set of records
  // (or a count no longer asked) are never drawn.
  return question && held?.question === question ? held.counts : null;
}
