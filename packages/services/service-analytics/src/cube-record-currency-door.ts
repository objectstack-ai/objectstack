// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D6] The cube door's record-currency judgment: a `sum` / `avg` /
 * `min` / `max` measure over a `currencyMode: 'record'` amount is refused
 * `INVALID_FIELD` / 400 unless the same query groups by that amount's code
 * field (`currencyConfig.currencyField`), ahead of strategy selection.
 *
 * ## The shape this closes
 *
 * A record-mode amount is a bare number (ADR-0104 D1) whose currency lives in a
 * sibling code field, one per row. An aggregate that does not group by the code
 * adds, averages or orders numbers in different currencies: the measurement
 * round on #8345 (probe A) saw a USD row of 100 and an EUR row of 100 answer
 * `200`, labelled with the tenant currency. Grouped by the code, every group
 * holds one currency and the answer is right (probe C); the per-row label is
 * the result column's `currencyField` (`AnalyticsResult.fields`,
 * `@objectstack/spec/contracts`).
 *
 * ## Where it stands
 *
 * In `AnalyticsService.ensureCube`, on every path out of it, right after the
 * #21044 measure × field-type door (`cube-measure-field-type-door.ts`): ahead
 * of both strategies, for `query()` and `generateSql()` alike. A dataset
 * selection reaches it through `DatasetExecutor`, so its primary grid, every
 * `totals` grouping (the grand total `[]` included) and the `compareTo` pass
 * are judged one by one: a grouping that drops the code is a sum across
 * currencies like any other.
 *
 * ## What it judges
 *
 * - Every `measures` entry that resolves to a cube measure of type `sum`,
 *   `avg`, `min` or `max` (ADR-0144 open item 10). `count` and
 *   `count_distinct` read no amount and are not judged.
 * - The measure's column, located on the object that declares it by the
 *   caller's resolver (`declaredMeasureColumn`, the one the #21044 door reads).
 * - "Grouped by the code" means a `dimensions` entry whose column is the code
 *   field on that SAME object. A time dimension is no currency group, and a
 *   `where` that happens to pin one code is not judged: the rule is the
 *   grouping, so an answer's label never depends on what a filter selected.
 *
 * ## Not judged — "cannot answer, do not block"
 *
 * - A host that wires no `sourceFieldMeta`, or a cube whose `sql` is not a
 *   bare object name (the caller stands down for both).
 * - A member that resolves to no declared measure, a `sql` that is not a
 *   column reference, or a column whose declaration names no `record` mode.
 *
 * ## The envelope
 *
 * `INVALID_FIELD` / 400 through `invalidMemberError` (ADR-0112), with the
 * column and its object attached, as the #21044 door attaches them: a verdict
 * about one member the request named. The words carry the prescription:
 * group by the code field. A consolidated total aggregates the stored home
 * field instead (ADR-0144 D6), which the write-time projection (D5) fills.
 */

import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { MeasureColumn } from './cube-measure-field-type-door.js';
import { invalidMemberError } from './dataset-refusal.js';

/** The aggregates that read the amount itself (ADR-0144 open item 10). */
const AMOUNT_AGGREGATES: ReadonlySet<string> = new Set(['sum', 'avg', 'min', 'max']);

/**
 * Refuse the first `measures` entry of `query` that aggregates a record-mode
 * amount without grouping by its code field — `INVALID_FIELD` / 400. See the
 * module header.
 *
 * @param measureOf - The cube measure a `measures` entry resolves to: its
 *   `type`, and the column it aggregates (`null` when its `sql` is not a column
 *   reference) — or `undefined` when it resolves to no declared measure.
 * @param dimensionColumnOf - The column a `dimensions` entry groups by, located
 *   the same way, or `null` when this door cannot pin one.
 * @param recordCurrencyFieldOf - The `currencyConfig.currencyField` of a column
 *   declared `currencyMode: 'record'`, or `undefined` for any other column.
 */
export function assertRecordCurrencyAggregatesGrouped(
  query: AnalyticsQuery,
  cubeName: string,
  measureOf: (member: string) => { type: unknown; column: MeasureColumn | null } | undefined,
  dimensionColumnOf: (member: string) => MeasureColumn | null,
  recordCurrencyFieldOf: (object: string, field: string) => string | undefined,
): void {
  const measures = query.measures ?? [];
  if (measures.length === 0) return;
  let grouped: Array<MeasureColumn | null> | undefined;
  for (const member of measures) {
    const measure = measureOf(member);
    if (!measure?.column || typeof measure.type !== 'string' || !AMOUNT_AGGREGATES.has(measure.type)) continue;
    const target = measure.column;
    const codeField = recordCurrencyFieldOf(target.object, target.column);
    if (codeField === undefined) continue;
    grouped ??= (query.dimensions ?? []).map(dimensionColumnOf);
    if (grouped.some((d) => d?.object === target.object && d.column === codeField)) continue;

    const codePath = target.path === target.column
      ? codeField
      : `${target.path.slice(0, target.path.lastIndexOf('.') + 1)}${codeField}`;
    const err = invalidMemberError(
      `Measure '${member}' on cube '${cubeName}' takes the ${measure.type} of field '${target.path}', `
      + `a record-currency amount whose currency is each record's '${codeField}', but the query does not `
      + `group by '${codePath}', so the query was NOT run. Add the dimension over '${codePath}' to the `
      + `query, which answers one row per currency. Without the grouping the ${measure.type} would `
      + 'combine amounts in different currencies into one number.',
      { member, param: 'measures', cube: cubeName },
    ) as Error & { field?: string; object?: string };
    err.field = target.path;
    err.object = target.object;
    throw err;
  }
}
