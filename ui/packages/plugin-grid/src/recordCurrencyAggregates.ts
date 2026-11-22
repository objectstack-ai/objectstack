/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One rule on the grid for a measure whose unit each record names itself: a
 * raw aggregate over it is honest only inside one unit, so it needs the rows
 * grouped by the field holding that unit. Two measures read the rule:
 *
 *   - ADR-0144 D6, a `record`-mode amount (`currencyConfig.currencyMode:
 *     'record'`): the unit is the currency code in its `currencyField`.
 *     Adding 100 USD to 100 EUR answers a number that is no amount at all.
 *     Consolidated totals belong to the home field, an ordinary `dynamic`
 *     amount that totals unchanged.
 *   - ADR-0158 U7 R1, a `record`-mode quantity (a `number` declaring
 *     `unitConfig: { unitMode: 'record', unitField }`): the unit is the code
 *     in its `unitField`. 10 KGM and 10 LBR summed to 20. The engine refuses
 *     such an aggregate unless the query groups by `unitField`
 *     (`record-unit-aggregate-door.ts` in `@objectstack/objectql`), and this
 *     module reads the field exactly as that door's `recordUnitFieldOf` does.
 *
 * A group bucketed by that field holds one unit, so its `sum` / `avg` /
 * `min` / `max` stand; any other set of rows mixes units. The counts are
 * unit-free and always stand.
 */
import { recordCurrencyField } from '@object-ui/i18n';
import type { GroupAggregationConfig } from './useGroupedData';

/** The aggregates that read the measure itself: ADR-0144 Open item 10, ADR-0158 Open item 12. */
const MEASURE_AGGREGATES = new Set(['sum', 'avg', 'min', 'max']);

/** Whether `type` aggregates the measure itself (not a count of rows). */
export function isMeasureAggregate(type: string): boolean {
  return MEASURE_AGGREGATES.has(type);
}

/** Any object field def; only its `type`, `currencyConfig` and `unitConfig` are read. */
type MeasureFieldLike = object | null | undefined;

/**
 * [ADR-0158 U7 R1] The unit field of a `record`-mode quantity, or
 * `undefined`: a `number` field declaring `unitConfig: { unitMode: 'record',
 * unitField }` with a non-empty `unitField`, the reading the engine's
 * aggregate door makes. A `fixed`-mode quantity has one unit for every row,
 * and a number with no `unitConfig` has none to mix.
 */
export function recordUnitField(def: unknown): string | undefined {
  if (def === null || typeof def !== 'object') return undefined;
  const { type, unitConfig } = def as { type?: unknown; unitConfig?: unknown };
  if (type !== 'number' || unitConfig === null || typeof unitConfig !== 'object') return undefined;
  const { unitMode, unitField } = unitConfig as { unitMode?: unknown; unitField?: unknown };
  return unitMode === 'record' && typeof unitField === 'string' && unitField !== '' ? unitField : undefined;
}

/**
 * The field naming each record's unit of `def`'s measure — a `record`-mode
 * amount's code field, or a `record`-mode quantity's unit field — or
 * `undefined` when every row of `def` is in one unit.
 */
export function recordMeasureUnitField(def: MeasureFieldLike): string | undefined {
  return recordCurrencyField(def as Parameters<typeof recordCurrencyField>[0]) ?? recordUnitField(def);
}

/**
 * The field a measure aggregate over `field` needs to be grouped by, or
 * `undefined` when `type` reads no measure or `field` is in one unit (any
 * aggregate over it is honest as it stands).
 */
export function requiredAggregateGrouping(
  field: string,
  type: string,
  objectFields: Readonly<Record<string, MeasureFieldLike>> | undefined,
): string | undefined {
  if (!isMeasureAggregate(type)) return undefined;
  return recordMeasureUnitField(objectFields?.[field]);
}

/**
 * The group-header aggregations a set of groups may draw: every configured
 * one, minus each measure aggregate over a `record`-mode amount or quantity
 * whose unit field is not among `groupingFields`. Dropped before the rows are
 * bucketed and before the server is asked, so neither path adds amounts in
 * different currencies or quantities in different units.
 *
 * `groupingFields` are the fields ONE set of groups is bucketed by — one
 * header query's own `groupBy`. A nested group stands inside every level
 * above it and none below it, so with several levels each depth is judged on
 * its own prefix ({@link honestGroupAggregationsByDepth}); judged on every
 * level at once, a depth-1 header over `region` would keep a sum that only the
 * `unit_code` level beneath it makes one unit (objectstack#36276).
 */
export function honestGroupAggregations(
  aggregations: GroupAggregationConfig[] | undefined,
  objectFields: Readonly<Record<string, MeasureFieldLike>> | undefined,
  groupingFields: readonly string[],
): GroupAggregationConfig[] | undefined {
  if (!aggregations || aggregations.length === 0) return aggregations;
  const kept = aggregations.filter(({ field, type }) => {
    const unit = requiredAggregateGrouping(field, type, objectFields);
    return unit === undefined || groupingFields.includes(unit);
  });
  return kept.length === aggregations.length ? aggregations : kept;
}

/**
 * {@link honestGroupAggregations} per grouping depth (objectstack#36276):
 * index `d` holds what a group at depth `d + 1` may draw, judged on the first
 * `d + 1` of `groupingFields` — the levels that group stands inside, and the
 * `groupBy` its header query is compiled with. A measure aggregate over a
 * `record`-mode amount or quantity is kept from the depth that groups by its
 * unit or currency field down, and left out above it, the way a whole-set
 * summary leaves it out.
 */
export function honestGroupAggregationsByDepth(
  aggregations: GroupAggregationConfig[] | undefined,
  objectFields: Readonly<Record<string, MeasureFieldLike>> | undefined,
  groupingFields: readonly string[],
): Array<GroupAggregationConfig[] | undefined> {
  return groupingFields.map((_, d) => honestGroupAggregations(aggregations, objectFields, groupingFields.slice(0, d + 1)));
}
