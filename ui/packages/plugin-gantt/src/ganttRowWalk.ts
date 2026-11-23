/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  extractRecords,
  nonGridRowCeilingQuery,
  GANTT_ROW_CEILING,
} from '@object-ui/core';

/**
 * The most rows ONE gantt read asks for: the shared non-grid ceiling plus its
 * probe row (2,001), the same single request the calendar, map, tree and
 * timesheet send.
 *
 * The gantt's own ceiling ({@link GANTT_ROW_CEILING}, 10,000, objectstack#32421
 * ruling B) is a stop condition, not a request size. It used to be sent as one
 * `$top` of 10,001, and a host that sets a maximum page size refuses any read
 * over it before running the query (`OS_DATA_MAX_PAGE_SIZE`, 400
 * `MAX_RECORDS_EXCEEDED`, never clamped). The hosted plane sets 5,000, so every
 * hosted gantt showed that refusal in place of the chart, an EMPTY one too: the
 * refusal is decided by the `$top` asked for, not by the rows the object holds.
 *
 * So the gantt walks its result set in steps of this size, and asks no single
 * read for more than the other non-grid views already ask for. A deployment
 * whose maximum page size is below this refuses all five views alike; the
 * gantt is no longer the one view that needs a larger page than the rest.
 */
export const GANTT_FETCH_STEP: number = nonGridRowCeilingQuery().$top;

/**
 * Read the gantt's filtered result set up to {@link GANTT_ROW_CEILING} plus
 * the probe row, in steps of at most {@link GANTT_FETCH_STEP} rows.
 *
 * The first read is the query as authored, `$top` the step. When it answers
 * short (the whole set fits one step, the common case) or longer than the step
 * (an adapter that ignores `$top`, which the ceiling then slices), it settles
 * the set and is returned AS IS, envelope and all: one read, exactly as before.
 *
 * Only a FULL first answer means more rows exist, and then the set is walked
 * from the top under a UNIQUE order: the authored `$orderby` with `id` appended
 * as the tie-breaker, in the last key's direction (`asc` when there is none).
 * Offset steps over an order with ties may repeat one row and skip another on
 * an adapter that does not break ties itself (the platform's drivers append the
 * same `id` key to a paged read, so there it changes nothing). The first read
 * is not reused, because it was not taken under that order. Rows are kept once
 * by `id` (`_id`); a row with neither is kept as it comes. `$top` is the step
 * (or the rows still wanted, at the end), `$skip` moves by the rows that came
 * back, and the walk stops at the first short answer or one row past the
 * ceiling, so `applyNonGridRowCeiling(result, GANTT_ROW_CEILING)` still reads
 * truncation from the rows in hand. The walk's answer is `{ data, total? }`,
 * with the newest `total` a read reported.
 *
 * `isCurrent` is asked after every answer: when a newer reload owns the screen
 * the walk stops asking, and its caller discards what it has.
 */
export async function fetchGanttRows(
  find: (params: Record<string, unknown>) => Promise<unknown>,
  params: Record<string, unknown>,
  isCurrent: () => boolean = () => true,
): Promise<unknown> {
  const wanted = GANTT_ROW_CEILING + 1;
  const firstTop = Math.min(GANTT_FETCH_STEP, wanted);
  const first = await find({ ...params, $top: firstTop });
  if (extractRecords(first).length !== firstTop || !isCurrent()) return first;

  const ordered = { ...params, $orderby: withIdTieBreak(params.$orderby) };
  const data: unknown[] = [];
  const seen = new Set<string>();
  let read = 0;
  let total = reportedTotal(first);
  while (data.length < wanted) {
    const top = Math.min(GANTT_FETCH_STEP, wanted - data.length);
    const result = await find({ ...ordered, $top: top, ...(read > 0 ? { $skip: read } : {}) });
    const rows = extractRecords(result);
    total = reportedTotal(result) ?? total;
    read += rows.length;
    for (const row of rows) {
      const id = rowId(row);
      if (id !== undefined) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      data.push(row);
    }
    if (rows.length < top || !isCurrent()) break;
  }
  return total !== undefined ? { data, total } : { data };
}

/**
 * `$orderby` with `id` appended as the last key, in the last authored key's
 * direction (`asc` when nothing was authored). An order that already names
 * `id` is returned unchanged.
 */
export function withIdTieBreak(orderby: unknown): Record<string, 'asc' | 'desc'> {
  const keys = orderby && typeof orderby === 'object' && !Array.isArray(orderby)
    ? (orderby as Record<string, 'asc' | 'desc'>)
    : {};
  if ('id' in keys) return { ...keys };
  const directions = Object.values(keys);
  return { ...keys, id: directions.length > 0 ? directions[directions.length - 1] : 'asc' };
}

function rowId(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const id = (row as { id?: unknown; _id?: unknown }).id ?? (row as { _id?: unknown })._id;
  return id === undefined || id === null ? undefined : String(id);
}

function reportedTotal(result: unknown): number | undefined {
  const total = result && typeof result === 'object' ? (result as { total?: unknown }).total : undefined;
  return typeof total === 'number' ? total : undefined;
}
