// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27074] The drill bounds of a `timeDimensions[].dateRange` window: the
 * half-open `[gte, lt)` the dataset answer reports in `drillRanges`, so a drill
 * list filters by exactly the window the query filtered by.
 *
 * ## Why the answer reports it
 *
 * A report run inside a picked period (`selection.timeDimensions: [{ dimension,
 * dateRange }]`) counts only that period's records, but `drillRanges` used to
 * cover only the date dimensions the answer GROUPS by. A windowed dimension
 * that is not grouped got no entry, so the drill list behind a stage bar
 * listed every period's records; and an edge bucket wider than the window
 * (a month cut by `last_30_days`) drilled the whole month. Re-deriving the
 * window in the browser would be a second date resolver: the server resolves a
 * preset at the request time zone's midnight, while a browser macro yields a
 * bare day that the engine cuts at UTC midnight on a `datetime` column.
 *
 * ## ⛔ No second lowering
 *
 * Every step is the one the query itself takes:
 *
 * 1. {@link lowerDatasetCompareDateRange}, this package's registered face in
 *    the shared `dateRange` conformance kit: a preset through
 *    `resolveAnalyticsDateRangeString` at the reference time zone, an explicit
 *    `[a, b]` through `explicitDateRangeWindow`, untouched.
 * 2. The pair both strategies build from that window,
 *    {@link dateRangeWindowBounds}: a resolved preset's instants, or on a
 *    `date` column the calendar days it covers in the reference zone (#27172);
 *    an explicit window's own bounds. Then {@link normalizeDateRangeWindow},
 *    the shared lowering. Its whole-day rule turns a bare-day `$lte` into
 *    `$lt` the next day. It is applied as for a `datetime` column on every column, which
 *    `calendar-day.ts` records is order-equivalent to `<= day` on a `date`
 *    column, so one `[gte, lt)` shape serves both.
 * 3. `temporalStorageForm`, the rule the engine reads every temporal
 *    comparand through: a canonical UTC instant for `datetime`, the leading
 *    `YYYY-MM-DD` for `date`.
 *
 * A window that cannot be stated as `[gte, lt)` gets no bounds, and the drill
 * stays the superset it was: an explicit end that is an instant (the query
 * compares `<=` it, which no exclusive bound restates exactly), and an end on
 * the last supported day, where the query compiles no upper bound.
 */

import { temporalStorageForm } from '@objectstack/core';
import { dateRangeWindowBounds, lowerDatasetCompareDateRange } from './dataset-executor.js';
import { normalizeDateRangeWindow, type NormalizedFilterNode } from './strategies/filter-normalizer.js';

/** How a drill bound is spelled: the storage form of the window's column. */
export type DrillBoundForm = 'datetime' | 'date';

/** A half-open drill bound pair, both ends in one {@link DrillBoundForm}. */
export interface DrillWindowBounds {
  gte: string;
  lt: string;
}

/** The member name the window is lowered under; the bounds do not depend on it. */
const MEMBER = 'window';

/** The whole-day rule on every column — see step 2 of the module note. */
const WHOLE_DAY = { isDatetimeColumn: () => true };

/**
 * The `[gte, lt)` a `dateRange` window filtered by, spelled in `form`, or
 * `undefined` when the window has no exact half-open spelling.
 *
 * @param dateRange - The entry's `dateRange`, `{token}` placeholders already
 *   resolved the way the executor resolves them.
 * @param timezone - The reference time zone the query resolved a preset in.
 */
export function drillWindowBounds(
  dateRange: string | readonly unknown[],
  timezone: string,
  form: DrillBoundForm,
): DrillWindowBounds | undefined {
  const window = lowerDatasetCompareDateRange(dateRange, timezone);
  const bounds = dateRangeWindowBounds(window, timezone, form === 'date');
  const node = normalizeDateRangeWindow(MEMBER, bounds, WHOLE_DAY);
  const leaves: NormalizedFilterNode[] = node?.kind === 'and' ? node.children : node ? [node] : [];
  let gte: unknown;
  let lt: unknown;
  for (const leaf of leaves) {
    if (leaf.kind !== 'leaf' || leaf.member !== MEMBER || leaf.values.length !== 1) return undefined;
    if (leaf.operator === 'gte' && gte === undefined) gte = leaf.values[0];
    else if (leaf.operator === 'lt' && lt === undefined) lt = leaf.values[0];
    else return undefined;
  }
  if (gte === undefined || lt === undefined) return undefined;
  const spell = (v: unknown): string | undefined => {
    const s = temporalStorageForm(v, form);
    return typeof s === 'string' ? s : undefined;
  };
  const gteSpelled = spell(gte);
  const ltSpelled = spell(lt);
  return gteSpelled !== undefined && ltSpelled !== undefined ? { gte: gteSpelled, lt: ltSpelled } : undefined;
}
