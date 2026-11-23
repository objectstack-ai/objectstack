/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The records a drilled record's page steps through
 * (objectstack-ai/objectstack#36554): every record the drill matched, in the
 * drill list's order, and not only the page of them the list drew.
 *
 * The list reports the query behind the rows it drew (`onFindParamsChange`)
 * and the count that query matched (`onTotalChange`). When the count is more
 * than the rows drawn, or the rows drawn are not the first page, the drill
 * re-issues that query for ids alone — the same filter, sort and search,
 * window by window — so the page's 「N of M」 says where the record sits in the
 * whole result and ↑ ↓ walk all of it.
 *
 * Bounded: at most {@link DRILL_RECORD_STEP_CAP} ids are read. A record past
 * that bound, a read that fails, or a result that moved under the list (the
 * opened record is not among the ids read) keeps the rows drawn as the step
 * set, which is what a drill handed the page before; the count is handed as
 * it was matched either way.
 */

import type { DrillRecordOrigin } from '@object-ui/react';

/** The most ids a drill reads for its record page's step set. */
export const DRILL_RECORD_STEP_CAP = 1000;

/**
 * The fewest rows one id read asks for: the list's own fetch batch
 * (`DEFAULT_LIST_FETCH_BATCH_SIZE` in `@object-ui/plugin-list`), which a host
 * already serves to the list itself. A list paged wider asks for its own page.
 */
const MIN_STEP_WINDOW = 100;

type Row = Record<string, unknown>;

interface FindCapable {
  find: (objectName: string, params: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface DrillRecordStepInput {
  dataSource: unknown;
  objectName: string;
  /** The record opened. */
  recordId: string;
  /** The ids of the rows the list drew, in order. */
  drawn: readonly string[];
  /** The count the list's query matched. */
  total?: number;
  /** The params of the read behind the rows drawn, as the list reported them. */
  findParams?: Readonly<Record<string, unknown>> | null;
}

const idOf = (row: Row): string | undefined => {
  const id = row?.id ?? row?._id;
  return id == null || id === '' ? undefined : String(id);
};

/** A data source's `find` answers `{ data, total }` (`QueryResult`). */
const rowsOf = (result: unknown): Row[] => {
  const data = (result as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(data) ? (data as Row[]) : [];
};

const positiveInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;

/**
 * The origin a drilled record's page opens with (see the file header). Answered
 * at once, with no read, when the rows drawn are the whole result; a promise
 * only when the rest has to be read.
 */
export function drillRecordOrigin(input: DrillRecordStepInput): DrillRecordOrigin | Promise<DrillRecordOrigin> {
  const { dataSource, objectName, recordId, drawn, total, findParams } = input;
  const siblings = drawn.includes(recordId) ? [...drawn] : [recordId];
  const drawnOrigin: DrillRecordOrigin = { siblings, ...(total != null ? { total } : {}) };
  const skip = positiveInt(findParams?.$skip) ?? 0;
  const ds = dataSource as FindCapable | null | undefined;
  if (
    total == null
    || !findParams
    || typeof ds?.find !== 'function'
    || (skip === 0 && drawn.length >= total)
  ) {
    return drawnOrigin;
  }

  return readWholeResult(ds, objectName, recordId, total, findParams, drawnOrigin);
}

async function readWholeResult(
  ds: FindCapable,
  objectName: string,
  recordId: string,
  total: number,
  findParams: Readonly<Record<string, unknown>>,
  drawnOrigin: DrillRecordOrigin,
): Promise<DrillRecordOrigin> {
  const query: Record<string, unknown> = { ...findParams };
  for (const key of ['$top', '$skip', '$select', '$expand', '$count']) delete query[key];
  const window = Math.max(positiveInt(findParams.$top) ?? 0, MIN_STEP_WINDOW);
  const wanted = Math.min(total, DRILL_RECORD_STEP_CAP);
  const windows = Math.ceil(wanted / window);
  try {
    const answers = await Promise.all(
      Array.from({ length: windows }, (_, w) =>
        ds.find(objectName, { ...query, $select: ['id'], $top: window, ...(w > 0 ? { $skip: w * window } : {}) })),
    );
    const ids = answers
      .flatMap(rowsOf)
      .map(idOf)
      .filter((id): id is string => !!id)
      .slice(0, DRILL_RECORD_STEP_CAP);
    if (!ids.includes(recordId)) return drawnOrigin;
    return { siblings: ids, total: Math.max(total, ids.length) };
  } catch {
    return drawnOrigin;
  }
}
