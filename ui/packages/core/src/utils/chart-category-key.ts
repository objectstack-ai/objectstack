/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * chart-category-key — the ONE answer to "which result column carries the
 * CATEGORY?" for an object-bound chart (objectui#8269).
 *
 * The mirror of `chart-measure-key` (objectui#8266) on the other axis. That
 * card landed `chartMeasureKey` over the contract's `chartAggregateValueKey`;
 * the contract publishes a CATEGORY sibling in the same module —
 * `chartAggregateCategoryKey` — and nothing in this repository read it.
 *
 * ## The disagreement this replaces
 *
 * Both dashboard relays composed the category binding as a LITERAL FLOOR:
 *
 *   const xAxisKey = options.xField || 'name';
 *
 * and handed it to the `object-chart` node without ever consulting the
 * `aggregate` that decides it. An object-bound aggregate returns one row per
 * group, keyed by the raw `groupBy` field, so a widget declaring
 * `aggregate: { function: 'count', groupBy: 'status' }` and no `options.xField`
 * bound `'name'` against rows keyed `'status'`.
 *
 * Unlike the measure half, this one is LOUD: `hasNoCategoryKey`
 * (`plugin-charts/src/AdvancedChartImpl.tsx`, framework#4033) fires and the
 * author reads "This chart cannot plot its category axis: no row has a `name`
 * field." The diagnostic is wrong-CAUSE — it names a binding the author never
 * wrote and never mentions the `groupBy` they did — so it points at the wrong
 * layer. Being loud makes it a lesser harm than objectui#8266, not a
 * non-defect: measured over the rows a fieldless count returns,
 * `[{status:'open',count:2},{status:'paid',count:5}]`, an `xAxisKey` of
 * `'name'` refuses under BOTH series bindings, i.e. objectui#8266's fix does
 * not reach this authoring shape at all.
 *
 * ## Why the answer is delegated rather than restated
 *
 * Restating the rule here would make this file a second opinion of a question
 * the contract already answers — the objectui#5042 / #7544 / #8193 / #8168
 * drift shape that `chart-measure-key` exists to end. So the rule stays
 * upstream in `@objectstack/spec/ui` and this is the seam objectui-side callers
 * share.
 *
 * ## ⚠️ NOT the same function as `resolveChartCategoryField`
 *
 * `plugin-charts`' own `resolveChartCategoryField` (objectui#8168) reads
 * `aggregate.groupBy` first too — which is exactly why `ObjectChart` does NOT
 * refuse this shape at its own level, and then forwards `schema.xAxisKey`
 * verbatim as the render binding anyway. But the two answer DIFFERENT
 * questions and must not be collapsed:
 *
 *   - `resolveChartCategoryField` answers "which FIELD is the category?" — its
 *     structured-`groupBy` leg returns `node.field`, because its two readers
 *     are the refusal (does the author name a category at all?) and the
 *     field-metadata probe that loads that field's option labels and colours.
 *   - this function answers "which COLUMN do the returned rows carry it
 *     under?" — `groupBy.alias ?? groupBy.field` per the contract, because an
 *     `alias` (admitted by `ChartGroupBySchema`) renames the projected column.
 *
 * They coincide whenever no alias is written, which is why the distinction is
 * easy to miss; conflating them would either bind an axis to a column the rows
 * do not carry, or probe field metadata for a field that does not exist.
 */

import { chartAggregateCategoryKey, type ChartAggregateLike } from '@objectstack/spec/ui';

/**
 * The result column a chart's category axis / x-axis binding must name.
 *
 * `fallback` is the caller's own floor, used ONLY when the contract has no
 * answer — a chart that declares no `aggregate` at all (its rows are raw
 * records or authored literals, where the author's `xField` is the right key),
 * an UNGROUPED aggregate (one row, no category column), or a `groupBy` shape
 * `ChartGroupBySchema` already rejects. It is never a second opinion about an
 * aggregate the contract CAN answer for.
 *
 * @param aggregate the chart's inline aggregate, or `undefined`
 * @param fallback  the key to bind when the contract has no answer
 */
export function chartCategoryKey(
  aggregate: ChartAggregateLike | undefined,
  fallback: string,
): string {
  return chartAggregateCategoryKey(aggregate) ?? fallback;
}
