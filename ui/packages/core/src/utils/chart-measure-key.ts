/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * chart-measure-key — the ONE answer to "which result column carries the
 * measure?" for an object-bound chart (objectui#8266).
 *
 * ## The disagreement this replaces
 *
 * The question was answered independently in three places, and for a FIELDLESS
 * `count` — the normal way to author "how many records per status", and the
 * most common dashboard chart there is — two of them answered differently:
 *
 *   - the ROW PROJECTION (`aggregateValueKey` / `aggregateRecords` /
 *     `runAggregate`'s alias, all in `plugin-charts/src/ObjectChart.tsx`) keys
 *     the value column `'count'`, the alias the engine projects `COUNT(*)`
 *     under;
 *   - the SERIES BINDING, spelled twice in `plugin-dashboard`
 *     (`DashboardGridLayout.tsx` and `DashboardRenderer.tsx`), read
 *     `aggregate.field || (options.yField || 'value')` and so bound `'value'`.
 *
 * A `dataKey` naming a column no row carries plots nothing, and nothing says
 * so: measured on `origin/main` `0fa7a9c83`, rows `[{status:'open',count:2},
 * {status:'paid',count:5}]` with `series:[{dataKey:'value'}]` rendered a
 * `.recharts-surface` with the category ticks "open"/"paid", **0 bars, 0
 * rectangles**, no refusal and no empty state — the same rows under
 * `dataKey:'count'` drew 2 rectangles. An empty chart reads as "no data yet",
 * which is exactly what an author with a genuinely empty object also sees.
 *
 * ## Why the answer is delegated rather than restated
 *
 * `chartAggregateValueKey` in `@objectstack/spec/ui` is the CONTRACT's own
 * derivation — "the VALUE column an object-bound aggregate produces … what a
 * chart's series / y-axis binding must name". Producers and checkers already
 * read it. Restating the rule here would make this file a fourth opinion of the
 * same question, which is the shape (objectui#5042 / #7544 / #8193 / #8168)
 * this module exists to end. So the rule lives upstream in the spec and this is
 * the seam objectui-side callers share, exactly as `humanizeLabel` (objectui#5444)
 * and `buildChartSeries` (ADR-0021) already are.
 *
 * ⛔ The inverse fix — making the row projection key a fieldless count
 * `'value'` — is not available: it contradicts a pin the tree already carries
 * (`ObjectChart.aggregateResultColumns.test.ts`) and renames the column every
 * other consumer reads, including the engine's own `COUNT(*)` alias.
 */

import { chartAggregateValueKey, type ChartAggregateLike } from '@objectstack/spec/ui';

export type { ChartAggregateLike };

/**
 * The result column a chart's series must bind to.
 *
 * `fallback` is the caller's own floor, used ONLY when the contract has no
 * answer — a chart that declares no `aggregate` at all (its rows are raw
 * records or authored literals, where the author's `yField` is the right key),
 * or an aggregate shape `ChartAggregateSchema` already rejects. It is never a
 * second opinion about an aggregate the contract CAN answer for.
 *
 * @param aggregate the chart's inline aggregate, or `undefined`
 * @param fallback  the key to bind when the contract has no answer
 */
export function chartMeasureKey(
  aggregate: ChartAggregateLike | undefined,
  fallback: string,
): string {
  return chartAggregateValueKey(aggregate) ?? fallback;
}
