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
 * `$top` is the step (or the rows still wanted, at the end), `$skip` moves by
 * the rows that came back, and the walk stops at the first short answer or one
 * row past the ceiling, so `applyNonGridRowCeiling(result, GANTT_ROW_CEILING)`
 * still reads truncation from the rows in hand. A platform read that carries
 * `limit` or `offset` is a partition of the result set (the drivers append the
 * `id` tie-breaker), so the steps neither repeat nor skip a row.
 *
 * A first answer that already settles it is returned AS IS, envelope and all:
 * a short one (the whole set fits one step, the common case) or one longer than
 * the step (an adapter that ignores `$top`, which the ceiling then slices).
 * Only a walk of several steps is re-wrapped, as `{ data, total? }`, with the
 * newest `total` an answer reported.
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
  const firstRows = extractRecords(first);
  if (firstRows.length !== firstTop || !isCurrent()) return first;

  const data: unknown[] = [...firstRows];
  let total = reportedTotal(first);
  while (data.length < wanted) {
    const top = Math.min(GANTT_FETCH_STEP, wanted - data.length);
    const result = await find({ ...params, $top: top, $skip: data.length });
    const rows = extractRecords(result);
    total = reportedTotal(result) ?? total;
    data.push(...rows);
    if (rows.length < top || !isCurrent()) break;
  }
  return total !== undefined ? { data, total } : { data };
}

function reportedTotal(result: unknown): number | undefined {
  const total = result && typeof result === 'object' ? (result as { total?: unknown }).total : undefined;
  return typeof total === 'number' ? total : undefined;
}
