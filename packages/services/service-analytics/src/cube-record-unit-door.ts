// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0158 U7 R1] The cube door's record-unit judgment: a `sum` / `avg` /
 * `min` / `max` measure over a `unitMode: 'record'` quantity is refused
 * `INVALID_FIELD` / 400 unless the same query groups by that quantity's unit
 * field (`unitConfig.unitField`), ahead of strategy selection. It mirrors the
 * record-currency door (`cube-record-currency-door.ts`, ADR-0144 D6) and
 * stands right after it.
 *
 * ## The shape this closes
 *
 * A record-mode quantity is a bare number whose unit lives in a sibling
 * `text` field, one code per row (ADR-0158 L3). An aggregate that does not
 * group by the unit adds, averages or orders numbers in different units:
 * measured before this door, a row of 10 KGM and a row of 10 LBR answered
 * `20` through the cube face. Grouped by the unit field, every group holds
 * one unit and the answer is right.
 *
 * ## Where it stands
 *
 * In `AnalyticsService.ensureCube`, on every path out of it (the inferred,
 * augmented and declared cubes), and in the ADR-0037 draft-preview branch of
 * `queryDataset`: each place that asks the record-currency door asks this one
 * next. A dataset selection reaches it through `DatasetExecutor`, so its
 * primary grid, every `totals` grouping (the grand total `[]` included) and
 * the `compareTo` pass are judged one by one.
 *
 * ## What it judges
 *
 * - Every `measures` entry that resolves to a cube measure of type `sum`,
 *   `avg`, `min` or `max` (ADR-0158 Open item 12, the aggregate half,
 *   mirroring ADR-0144 Open item 10). `count` reads no quantity and
 *   `count_distinct` adds nothing, so neither is judged.
 * - "Grouped by the unit" means a `dimensions` entry whose column is the unit
 *   field on that SAME object. A time dimension is no unit group, and a
 *   `where` that happens to pin one unit is not judged: the rule is the
 *   grouping, so an answer never depends on what a filter selected.
 * - A `fixed`-mode quantity and a `number` with no `unitConfig` are never
 *   judged: the host relays a `unitField` only under `record`.
 *
 * ## Not judged: "cannot answer, do not block"
 *
 * The record-currency door's stand-downs: no `sourceFieldMeta`, a cube whose
 * `sql` is not a bare object name, a member that resolves to no declared
 * measure or to a `sql` that is no column reference.
 *
 * ## The envelope
 *
 * `INVALID_FIELD` / 400 through `invalidMemberError` (ADR-0112), with the
 * column and its object attached, as the record-currency door attaches them.
 * No new wire code (ADR-0158 assigns none; ADR-0144 assigned none to the
 * twin). R1 has no base quantity (U7 R2), so the one remedy is the grouping.
 */

import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { MeasureColumn } from './cube-measure-field-type-door.js';
import { invalidMemberError } from './dataset-refusal.js';

/** The aggregates that read the quantity itself (ADR-0158 Open item 12, mirroring ADR-0144 Open item 10). */
export const QUANTITY_AGGREGATES: ReadonlySet<string> = new Set(['sum', 'avg', 'min', 'max']);

/**
 * Refuse the first `measures` entry of `query` that aggregates a record-mode
 * quantity without grouping by its unit field: `INVALID_FIELD` / 400. See the
 * module header.
 *
 * @param measureOf - The cube measure a `measures` entry resolves to, as the
 *   record-currency door reads it.
 * @param dimensionColumnOf - The column a `dimensions` entry groups by, or
 *   `null` when this door cannot pin one.
 * @param recordUnitFieldOf - For a column declared `unitMode: 'record'`, its
 *   `unitConfig.unitField` on the same object; `undefined` for any other.
 */
export function assertRecordUnitAggregatesGrouped(
  query: AnalyticsQuery,
  cubeName: string,
  measureOf: (member: string) => { type: unknown; column: MeasureColumn | null } | undefined,
  dimensionColumnOf: (member: string) => MeasureColumn | null,
  recordUnitFieldOf: (object: string, field: string) => string | undefined,
): void {
  const measures = query.measures ?? [];
  if (measures.length === 0) return;
  let grouped: Array<MeasureColumn | null> | undefined;
  for (const member of measures) {
    const measure = measureOf(member);
    if (!measure?.column || typeof measure.type !== 'string' || !QUANTITY_AGGREGATES.has(measure.type)) continue;
    const target = measure.column;
    const unitField = recordUnitFieldOf(target.object, target.column);
    if (unitField === undefined) continue;
    grouped ??= (query.dimensions ?? []).map(dimensionColumnOf);
    if (grouped.some((d) => d?.object === target.object && d.column === unitField)) continue;

    const prefix = target.path === target.column ? '' : target.path.slice(0, target.path.lastIndexOf('.') + 1);
    const unitPath = `${prefix}${unitField}`;
    const err = invalidMemberError(
      `Measure '${member}' on cube '${cubeName}' takes the ${measure.type} of field '${target.path}', `
      + `a quantity whose unit is each record's '${unitField}' (unitMode: 'record'), but the query does not group `
      + `by '${unitPath}', so the query was NOT run. Without the grouping the ${measure.type} would combine `
      + `quantities in different units into one number (10 KGM and 10 LBR summed to 20). Add the dimension over `
      + `'${unitPath}' to the query, which answers one row per unit.`,
      { member, param: 'measures', cube: cubeName },
    ) as Error & { field?: string; object?: string; unitField?: string };
    err.field = target.path;
    err.object = target.object;
    err.unitField = unitField;
    throw err;
  }
}
