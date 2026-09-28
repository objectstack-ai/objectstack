// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20445] The `$empty` operator on this package's three SQL compilers: the
 * read-scope lowering (`read-scope-sql.ts`), `NativeSQLStrategy.buildFilterClause`
 * and the `ObjectQLStrategy` echo of it. Ruling A on #20399 gives each compile
 * surface an arm for the operator, and the spec gives every arm ONE expansion
 * to call, `expandEmptyOperator(fieldDef)` (`@objectstack/spec/data`): the
 * per-type 「is empty」 table ruled on #20311.
 *
 * | the field's declared row (`EmptyOperatorExpansion.arm`) | `$empty: true` matches | `$empty: false` |
 * |---|---|---|
 * | `text` (the text-like types) | null or `''` | the complement |
 * | `multi_value` (a list-valued field) | null or `[]` | the complement |
 * | `null_only` (every other type) | null | the complement |
 *
 * ## Why a compiler asks the host, and what it does when the host cannot answer
 *
 * The row is a property of the field's DECLARATION (its type, and `multiple`
 * for the multi-capable types), which the filter does not carry. The host
 * answers it through {@link DatasetScopedStrategyContext.declaredValueShape},
 * from the same `AnalyticsServiceConfig.sourceFieldMeta` hook the
 * declared-type rule (#14079) reads. The compiler then calls the spec's
 * expansion itself; this module never restates the table.
 *
 * A host that cannot answer (no field metadata wired, or no such field on the
 * object) gets a REFUSAL, never a guess. The "no declaration" reading the spec
 * gives the JS faces (null, `''` and `[]` all empty, `isEmptyFilterValue`
 * without an expansion) cannot be compiled to SQL without the type either: a
 * `''` comparison against a numeric column is a type error on Postgres, and
 * an empty list is only recognisable as JSON. So "cannot answer, do not block"
 * — the posture the declared-type rule takes for text operators, which had a
 * behaviour to fall back to — has nothing to fall back to here.
 *
 * ## The SQL, per row
 *
 * - `null_only`: `col IS NULL` / `col IS NOT NULL`.
 * - `text`: `(col IS NULL OR col = '')` / `(col IS NOT NULL AND col <> '')`,
 *   the empty string bound like every other comparand.
 * - `multi_value`: `(col IS NULL OR L)` / `(col IS NOT NULL AND NOT L)`, where
 *   `L` is the dialect's test for "this stored value is the empty JSON list".
 *   A multi-value field is a JSON column on the SQL family (`driver-sql`'s
 *   `isMultiValueField`-keyed storage): TEXT on SQLite, `json` on Postgres and
 *   MySQL. `L` is FALSE, never NULL, for any stored value that is not an empty
 *   list, a non-array JSON value included.
 *
 * Every predicate is TOTAL — TRUE or FALSE for every row, never UNKNOWN —
 * because both polarities spell their NULL case out. So a `$not` over `$empty`
 * needs no NULL guard (`operatorIsNullTotal` answers `true` for it on both
 * faces), and `NOT (…)` is the exact complement.
 *
 * `L` has no construct on the `'unknown'` dialect: no JSON test parses on all
 * three dialects, and the text-match family's `unknown` arm (a construct that
 * happens to parse everywhere) has no counterpart here. The multi-value row
 * is refused there; the other two rows need no dialect and are compiled on
 * every one.
 */

import { expandEmptyOperator, type EmptyOperatorExpansion, type ValueShapeFieldDef } from '@objectstack/spec/data';
import type { StrategyContext } from '@objectstack/spec/contracts';
import type { DatasetScopedStrategyContext } from './strategies/types.js';
import { invalidFilterError } from './strategies/filter-normalizer.js';
import { sqlDialectFor, type AnalyticsSqlDialect } from './text-match-sql.js';

/**
 * The per-object question "what is this field's declared value shape?", read
 * off the context's `declaredValueShape` hook, or `undefined` when the host
 * wired no hook. The same shape as `nonTextColumnResolver` (#14079).
 */
export function declaredValueShapeResolver(
  ctx: StrategyContext,
  objectName: string,
): ((field: string) => ValueShapeFieldDef | undefined) | undefined {
  const declared = (ctx as DatasetScopedStrategyContext).declaredValueShape;
  if (typeof declared !== 'function') return undefined;
  return (field: string) => declared.call(ctx, objectName, field);
}

/**
 * "Is this stored JSON value the empty list?", as one boolean SQL expression
 * that is FALSE (not NULL, not an error) for any other value, or `null` when
 * the dialect has no construct.
 *
 * - SQLite: a multi-value column is TEXT. `json_valid` is asked first, inside a
 *   `CASE` (whose branches are evaluated lazily, which a bare `AND` is not
 *   documented to be), so a malformed stored value answers FALSE instead of
 *   failing the statement; `json_type` keeps a non-array JSON value (for which
 *   `json_array_length` answers 0) from counting as an empty list.
 * - Postgres: the column is `json`, which has no equality operator, so it is
 *   compared as `jsonb`, whose equality is structural.
 * - MySQL: the column is `JSON`; `JSON_LENGTH` answers 0 for an empty object
 *   too, so the type is asked beside it.
 */
function emptyJsonListSql(dialect: AnalyticsSqlDialect, column: string): string | null {
  switch (dialect) {
    case 'sqlite':
      return (
        `(CASE WHEN json_valid(${column}) THEN json_type(${column}) = 'array' ` +
        `AND json_array_length(${column}) = 0 ELSE 0 END)`
      );
    case 'postgres':
      return `(CAST(${column} AS jsonb) = CAST('[]' AS jsonb))`;
    case 'mysql':
      return `(JSON_TYPE(${column}) = 'ARRAY' AND JSON_LENGTH(${column}) = 0)`;
    default:
      return null;
  }
}

/** One `$empty` predicate to compile. */
export interface EmptyOperatorSqlRequest {
  /** The dialect that will run the statement; `'unknown'` has no multi-value arm. */
  dialect: AnalyticsSqlDialect;
  /** The column reference, already quoted / alias-qualified by the caller. */
  column: string;
  /** The field's row of the ruled table: `expandEmptyOperator(fieldDef)`. */
  expansion: EmptyOperatorExpansion;
  /** `true` for `$empty: true`, `false` for its complement. */
  empty: boolean;
  /** Push one value and return its placeholder, in the caller's own scheme. */
  bind: (value: unknown) => string;
}

/**
 * The `$empty` predicate for one field, or `null` when the dialect has no
 * construct for the field's row (the multi-value row on `'unknown'`). A `null`
 * answer binds nothing, so the caller's parameter list stays aligned with the
 * placeholders it has emitted, and the caller REFUSES — it never reads `null`
 * as "no constraint".
 */
export function emptyOperatorPredicateSql(req: EmptyOperatorSqlRequest): string | null {
  const { column, empty } = req;
  switch (req.expansion.arm) {
    case 'null_only':
      return empty ? `${column} IS NULL` : `${column} IS NOT NULL`;
    case 'text': {
      const blank = req.bind('');
      return empty ? `(${column} IS NULL OR ${column} = ${blank})` : `(${column} IS NOT NULL AND ${column} <> ${blank})`;
    }
    case 'multi_value': {
      const list = emptyJsonListSql(req.dialect, column);
      if (list === null) return null;
      return empty ? `(${column} IS NULL OR ${list})` : `(${column} IS NOT NULL AND NOT ${list})`;
    }
    default: {
      // The spec's `EmptyOperatorArm` is a closed union of the three rows
      // above; a fourth row reaching here is a spec change this module has not
      // been taught, and it must fail loudly rather than answer for a row
      // nobody wrote an arm for.
      const unknownArm: never = req.expansion.arm;
      throw new Error(`[analytics] no $empty arm for the declared row ${JSON.stringify(unknownArm)}`);
    }
  }
}

/**
 * The analytics `where` door's `empty` / `notEmpty` leaf (the normalizer's
 * lowering of `$empty: true | false`) as SQL, for the two compilers of that
 * door's tree: `NativeSQLStrategy.buildFilterClause`, whose statement
 * executes, and the `ObjectQLStrategy` echo of it.
 *
 * Refused in the `where` door's envelope (`INVALID_FILTER` / 400, message
 * kept — the caller wrote the filter) when the host cannot name the field's
 * declaration, or when a list-valued field meets the `'unknown'` dialect.
 * Both refusals come before anything binds.
 */
export function whereEmptyLeafSql(req: {
  ctx: StrategyContext | undefined;
  /** The (object, column) the leaf's member binds against; `undefined` = unknown. */
  target: { object: string; field: string } | undefined;
  column: string;
  empty: boolean;
  bind: (value: unknown) => string;
}): string {
  const { ctx, target } = req;
  const shape = ctx && target ? declaredValueShapeResolver(ctx, target.object)?.(target.field) : undefined;
  if (!ctx || !target || !shape) {
    const named = target ? `field "${target.field}" of "${target.object}"` : 'this field';
    throw invalidFilterError(
      `[analytics] Operator "$empty" is answered by the field's DECLARED type, and this analytics host ` +
        `could not name the declaration of ${named} (no field metadata is wired, or the object declares ` +
        `no such field). What counts as empty depends on it — null or '' for a text-like field, null or ` +
        `[] for a multi-value field, null only for every other type — so the operator is refused rather ` +
        `than guessed. Filter on a declared field, or use "$null" for "has no value". The filter was NOT ` +
        `applied.`,
    );
  }
  const sql = emptyOperatorPredicateSql({
    dialect: sqlDialectFor(ctx, target.object),
    column: req.column,
    expansion: expandEmptyOperator(shape),
    empty: req.empty,
    bind: req.bind,
  });
  if (sql === null) {
    throw invalidFilterError(
      `[analytics] Operator "$empty" on field "${target.field}" of "${target.object}" targets a multi-value ` +
        `field, whose empty list is tested with a JSON function that differs per SQL dialect, and the ` +
        `dialect of this datasource is not known to the analytics host. It is refused rather than ` +
        `guessed; "$null" answers "has no value" on every dialect. The filter was NOT applied.`,
    );
  }
  return sql;
}
