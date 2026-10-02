// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The COLUMN REFERENCE of the analytics author surface, declared once (ADR-0021
 * "zero raw SQL / zero raw expressions"; ADR-0049 enforce-or-remove).
 *
 * Two layers name a column, and they name it in ONE value at two depths: the
 * dataset compiler copies a dataset dimension's or measure's `field` into the
 * `sql` of the cube member it compiles to, verbatim. So the two slots take one
 * accept set, from this module:
 *
 * - the cube layer — `MetricSchema.sql` (`./analytics.zod.ts`, as its
 *   `CUBE_MEMBER_SQL`; #20943) / `DimensionSchema.sql`;
 * - the dataset layer — `DatasetMeasureSchema.field` /
 *   `DatasetDimensionSchema.field` (`../ui/dataset.zod.ts`; #21220).
 *
 * Admitted, and parsed byte-identically to before: a column of the object
 * (`amount`), and a relationship path of bare identifiers ending in one
 * (`account.amount`, `account.owner.region` — the chain
 * `NativeSQLStrategy#qualifyAndRegisterJoin` lowers into its LEFT JOINs and
 * the dataset compiler checks against `Dataset.include`). The path half is the
 * pattern the readers already use to tell a column path from an expression:
 * `IDENTIFIER_PATH` in `native-sql-strategy.ts`, and the field-level read
 * gate's bare-identifier / identifier-path pair in `analytics-service.ts`.
 *
 * Everything else is refused at parse: a `CASE WHEN …`, an aggregate or a
 * ratio of aggregates, a quoted or `$`-prefixed spelling, a padded or empty
 * string. Such a value names no single field, so no platform check could judge
 * which fields it reads.
 *
 * ## The row wildcard: admitted only where a `count` consumes it (#21409)
 *
 * `'*'` is the row wildcard — what a `count` aggregates (`COUNT(*)`), reading
 * no field value. It is admitted in exactly one place: a MEASURE whose
 * aggregate is `count`. Everywhere else it names nothing the runtime can
 * answer, and it is refused at parse. Two layers of the rule, one per kind of
 * slot:
 *
 * - **A dimension** — a cube dimension's `sql` and a dataset dimension's
 *   `field` — has no aggregate at all, so no `count` can ever consume the
 *   wildcard there. Both take {@link ANALYTICS_COLUMN_PATH}, the column path
 *   WITHOUT the `'*'` arm. Grouping by every column at once is not an axis,
 *   and the runtime never answered one — measured on #21220 at
 *   `POST /analytics/dataset/query`, a dimension whose `field` is `'*'`
 *   compiled to `SELECT * AS … GROUP BY *` on the native-SQL strategy and to
 *   `groupBy: ['*']` on the ObjectQL one, and was answered
 *   `500 DATABASE_ERROR` on both. A pattern, so the published JSON Schema
 *   carries this half as written.
 * - **A measure** — a cube measure's `sql` and a dataset measure's `field` —
 *   takes {@link ANALYTICS_COLUMN_REFERENCE}, the path WITH the `'*'` arm,
 *   and the wildcard is then judged against the measure's aggregate by the ONE
 *   predicate {@link rowWildcardOutsideCount}, which both measure schemas call
 *   from a refinement and neither restates. Under any aggregate other than
 *   `count` the strategies emitted `SUM(*)`, `AVG(*)`, `MIN(*)` / `MAX(*)` or
 *   `COUNT(DISTINCT *)` — measured on a dataset `sum` over `'*'` at the same
 *   door: `500 DATABASE_ERROR` on both strategies.
 *
 * The measure half is CROSS-FIELD (the slot and the aggregate beside it), so it
 * is a refinement rather than a pattern, and a refinement does not reach the
 * published JSON Schema: each site is declared in
 * `dropped-refinements.baseline.json` and named on the artifact as
 * `x-dropped-refinements`. A document a JSON-Schema validator accepts with
 * `'*'` under a non-count aggregate is refused at parse.
 *
 * Both patterns are built from the one {@link COLUMN_PATH} source below: one
 * pattern, one stated restriction, never a second copy that can drift.
 *
 * A module of its own, and outside the `data` barrel, so the two layers share
 * one declaration without it becoming published API (the
 * `../ui/analytics-carrier-filter.ts` precedent).
 */

/** A bare identifier, then zero or more `.identifier` hops — the column path. */
const COLUMN_PATH = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*';

/**
 * A column of the object, a relationship path ending in one, or the row
 * wildcard `'*'` — a MEASURE's slot: a cube measure's `sql` and a dataset
 * measure's `field`. The wildcard arm is admitted by the pattern and then held
 * to a `count` by {@link rowWildcardOutsideCount}.
 */
export const ANALYTICS_COLUMN_REFERENCE = new RegExp(`^(?:\\*|${COLUMN_PATH})$`);

/**
 * {@link ANALYTICS_COLUMN_REFERENCE} without the row wildcard — a column of the
 * object or a relationship path ending in one: a DIMENSION's slot, a cube
 * dimension's `sql` and a dataset dimension's `field`.
 */
export const ANALYTICS_COLUMN_PATH = new RegExp(`^${COLUMN_PATH}$`);

/** The row wildcard — what a `count` aggregates (`COUNT(*)`). */
const ROW_WILDCARD = '*';

/** The one aggregate that consumes {@link ROW_WILDCARD}. */
const ROW_WILDCARD_AGGREGATE = 'count';

/**
 * THE rule for the row wildcard in a measure (#21409): `true` when `reference`
 * is `'*'` and the measure's `aggregate` is anything but `count` — another
 * aggregate, or none at all. Called from the refinement of both measure
 * schemas (`MetricSchema`, with its `type`; `DatasetMeasureSchema`, with its
 * `aggregate`); neither restates it.
 *
 * Both arguments are `unknown` on purpose: a refinement runs on a value whose
 * other keys may already have failed their own checks, and the predicate
 * answers only the one question it is asked.
 */
export function rowWildcardOutsideCount(reference: unknown, aggregate: unknown): boolean {
  return reference === ROW_WILDCARD && aggregate !== ROW_WILDCARD_AGGREGATE;
}

/**
 * The refusal {@link rowWildcardOutsideCount} is answered with, worded once for
 * both measure slots: it names the slot and the aggregate the author wrote, and
 * prescribes the two ways out — a `count`, or a column.
 *
 * @param slot - the slot as the author reads it, e.g. `measures.<metric>.sql`
 * @param aggregateKey - the key that names the measure's aggregate there
 *   (`type` on a cube measure, `aggregate` on a dataset measure)
 * @param aggregate - the value the author wrote under `aggregateKey`
 */
export function rowWildcardOutsideCountRefusal(slot: string, aggregateKey: string, aggregate: unknown): string {
  const under = typeof aggregate === 'string'
    ? `under \`${aggregateKey}: '${aggregate}'\``
    : `with no \`${aggregateKey}\``;
  return (
    `\`${slot}\` is the row wildcard \`'*'\` ${under}. \`'*'\` is what a \`count\` aggregates `
    + '(`COUNT(*)`): it reads no field value, so it is admitted only on a `count` measure, and any other '
    + 'aggregate over it names no column to read — the analytics strategies sent it to the database '
    + 'as written, and the query failed there. '
    + `Declare \`${aggregateKey}: '${ROW_WILDCARD_AGGREGATE}'\` to count rows, or name the column this measure `
    + 'aggregates: a field of the object (`amount`) or a relationship path ending in one (`account.amount`).'
  );
}
