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
 * - the cube layer — `MetricSchema.sql` / `DimensionSchema.sql`
 *   (`./analytics.zod.ts`, as its `CUBE_MEMBER_SQL`; #20943);
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
 * ## The row wildcard, and the one restriction stated here
 *
 * `'*'` is the row wildcard — what a `count` aggregates (`COUNT(*)`), reading
 * no field value. {@link ANALYTICS_COLUMN_REFERENCE} admits it, for the slots
 * whose ruling admits it: both cube members (maintainer ruling D on #20943 named
 * one accept set "on a measure and a dimension alike") and a dataset MEASURE.
 * {@link ANALYTICS_COLUMN_PATH} is the same path WITHOUT that arm, for the one
 * slot where the wildcard has no meaning: a dataset DIMENSION. Grouping by
 * every column at once is not an axis, and the runtime never answered one —
 * measured on #21220 at `POST /analytics/dataset/query`, a dimension whose
 * `field` is `'*'` compiled to `SELECT * AS … GROUP BY *` on the native-SQL
 * strategy and to `groupBy: ['*']` on the ObjectQL one, and was answered
 * `500 DATABASE_ERROR` on both. Both patterns are built from the one
 * {@link COLUMN_PATH} source below: one pattern, one stated restriction, never a
 * second copy that can drift.
 *
 * They are `RegExp`s for `.regex()`, never refinements, so the published JSON
 * Schema carries each as a `pattern`: a document validated against
 * `json-schema/**` is judged as the parse judges it.
 *
 * A module of its own, and outside the `data` barrel, so the two layers share
 * one declaration without it becoming published API (the
 * `../ui/analytics-carrier-filter.ts` precedent).
 */

/** A bare identifier, then zero or more `.identifier` hops — the column path. */
const COLUMN_PATH = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*';

/**
 * A column of the object, a relationship path ending in one, or the row
 * wildcard `'*'` — a cube member's `sql` and a dataset measure's `field`.
 */
export const ANALYTICS_COLUMN_REFERENCE = new RegExp(`^(?:\\*|${COLUMN_PATH})$`);

/**
 * {@link ANALYTICS_COLUMN_REFERENCE} without the row wildcard — a column of the
 * object or a relationship path ending in one: a dataset dimension's `field`.
 */
export const ANALYTICS_COLUMN_PATH = new RegExp(`^${COLUMN_PATH}$`);
