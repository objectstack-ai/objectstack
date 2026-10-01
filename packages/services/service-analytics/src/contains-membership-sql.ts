// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20987] `$contains` / `$notContains` on a declared multi-valued or
 * JSON-stored field, for this package's two SQL faces that execute: the read
 * scope (`read-scope-sql.ts`) and `NativeSQLStrategy.buildFilterClause` (the
 * analytics `where`).
 *
 * ## The contract
 *
 * `FILTER_OPERATORS.$contains` (`@objectstack/spec/data`): on a `multiple: true`
 * field or a JSON-stored type the operator is a MEMBERSHIP test, an element of
 * the stored array equal to the comparand; on a scalar string column it stays
 * the substring test. The question is selected by the DECLARED column, which
 * these compilers read from the host's declared value shape
 * (`DatasetScopedStrategyContext.declaredValueShape`, the hook the `$empty`
 * arm already reads), asking the two spec predicates `driver-sql` asks for its
 * JSON columns: {@link STRUCTURED_JSON_TYPES} and {@link isMultiValueField}.
 *
 * ## The construct
 *
 * `@objectstack/core`'s `jsonMembershipPredicate`, the one per-dialect
 * implementation `driver-sql` emits through knex. This module only supplies the
 * placeholder plumbing: the already-quoted column, and the caller's
 * {@link TextMatchBind}. Both compilers used to send the operator through the
 * text-match family on every column, so on SQLite a row storing `["u10"]`
 * satisfied `$contains: 'u1'` (a substring of the stored JSON text), and on
 * PostgreSQL the `LIKE` over a `json` column was refused by the server.
 *
 * ## The `'unknown'` dialect
 *
 * There is no membership construct that parses on every engine, so a
 * JSON-stored field meets a REFUSAL there, never the substring residue
 * `driver-sql` keeps: on a read scope the residue is a scope admitting rows its
 * policy excludes. Each face refuses in its own envelope, before anything
 * binds — the posture `$empty` on a multi-value field already takes there
 * (`empty-operator-sql.ts`).
 *
 * ## What a host that names no declaration gets
 *
 * The text-match family, as before: without the declaration a JSON column
 * cannot be told from a text one, and "cannot answer, do not block" is the
 * posture the declared-type rule takes for the same hook (#14079). The
 * analytics plugin always wires the hook from the data engine.
 */

import { isMultiValueField, STRUCTURED_JSON_TYPES, type ValueShapeFieldDef } from '@objectstack/spec/data';
import type { StrategyContext } from '@objectstack/spec/contracts';
import { jsonMembershipPredicate } from '@objectstack/core';
import { declaredValueShapeResolver } from './empty-operator-sql.js';
import { invalidFilterError } from './strategies/filter-normalizer.js';
import { sqlDialectFor, type AnalyticsSqlDialect, type TextMatchBind } from './text-match-sql.js';

/**
 * Is the declared field's stored value JSON — a `STRUCTURED_JSON_TYPES` member,
 * or multi-valued by the spec's one definition? `false` for `undefined`: a
 * field the host cannot name keeps the text-match family.
 */
export function isJsonStoredShape(shape: ValueShapeFieldDef | undefined): boolean {
  if (!shape || typeof shape.type !== 'string') return false;
  return STRUCTURED_JSON_TYPES.has(shape.type) || isMultiValueField(shape);
}

/** One membership predicate to compile. */
export interface ContainsMembershipRequest {
  /** The dialect that will run the statement. */
  dialect: AnalyticsSqlDialect;
  /** The JSON column, already quoted / alias-qualified by the caller. */
  column: string;
  /** The author's comparand, as `$contains` takes it. */
  value: unknown;
  /** `$notContains`: the negation of the WHOLE membership test. */
  negate: boolean;
  /** The caller's placeholder plumbing. */
  bind: TextMatchBind;
}

/**
 * The membership predicate, or `null` on the `'unknown'` dialect. A `null`
 * answer binds nothing, so the caller's parameter list stays aligned, and the
 * caller REFUSES; it never reads `null` as "no constraint" or as "use the
 * substring test".
 *
 * The negation is `NOT (…)`, which is NULL for a NULL column on PostgreSQL and
 * MySQL: the NULL rule of `$notContains` (a row with no value satisfies it) is
 * the caller's wrapper, exactly as it is for the text-match family.
 */
export function containsMembershipSql(req: ContainsMembershipRequest): string | null {
  const positive = jsonMembershipPredicate(req.dialect, { column: () => req.column, value: (v) => req.bind(v) }, req.value);
  if (positive === null) return null;
  return req.negate ? `NOT ${positive}` : positive;
}

/**
 * The analytics `where` door's `contains` / `notContains` leaf on a declared
 * JSON-stored field, as SQL, or `null` when the field is not JSON-stored (or
 * the host cannot name it) and the leaf keeps the text-match family.
 *
 * Refused in the `where` door's envelope (`INVALID_FILTER` / 400, message
 * kept: the caller wrote the filter) when the dialect is `'unknown'`, before
 * anything binds.
 */
export function whereContainsMembershipSql(req: {
  ctx: StrategyContext;
  /** The (object, column) the leaf's member binds against. */
  target: { object: string; field: string };
  column: string;
  value: unknown;
  negate: boolean;
  bind: TextMatchBind;
}): string | null {
  const { ctx, target } = req;
  if (!isJsonStoredShape(declaredValueShapeResolver(ctx, target.object)?.(target.field))) return null;
  const sql = containsMembershipSql({
    dialect: sqlDialectFor(ctx, target.object),
    column: req.column,
    value: req.value,
    negate: req.negate,
    bind: req.bind,
  });
  if (sql === null) {
    const operator = req.negate ? '$notContains' : '$contains';
    throw invalidFilterError(
      `[analytics] Operator "${operator}" on field "${target.field}" of "${target.object}" targets a multi-valued ` +
        `or JSON-stored field, where it asks whether the comparand is an ELEMENT of the stored list. That test is ` +
        `a JSON function that differs per SQL dialect, and the dialect of this datasource is not known to the ` +
        `analytics host, so the operator is refused rather than answered as a substring of the stored text. ` +
        `The filter was NOT applied.`,
    );
  }
  return sql;
}
