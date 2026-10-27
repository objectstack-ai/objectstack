// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25521 cut 13] The cross-field and now-anchored comparison compile of
 * `SqlDriver`'s filter helpers: `applyCrossFieldComparison` (the #5222
 * column-to-column arm and its #14104 `addDays` offset),
 * `applyNowAnchorComparison` (the #25808 `{ $now, addDays }` comparand), and
 * the two operand builders both read, `nowAnchorBaseExpr` and
 * `crossFieldOffsetExpr`. They moved out of `sql-driver.ts` whole, with the
 * five module-level declarations only they read: the `addDays` operand reader
 * (`CrossFieldOffset`, `fieldReferenceOffsetOf`), the comparison class
 * (`crossFieldComparisonClass`, with the spec import it delegates to), and the
 * two refusal builders of the arm (`uncompilableFieldReferenceError`,
 * `uncompilableNowAnchorError`).
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited, and each moved declaration is byte-identical: the same four
 * validation rulings, the same total predicates, the same per-dialect day
 * arithmetic and the same refusals.
 *
 * What did NOT move, and why:
 *
 *  - `applyFilterCondition`, the one caller of both arms, holds the operator
 *    dispatch and stays with the rest of the filter compile.
 *  - `declaredFieldsFor`, `resolveTenantField`, `mapSortField`, `remoteColumn`
 *    and `filterColumnExpr` are read by members that stay too; the moved
 *    bodies reach them through the host.
 *  - The module-level declarations the bodies share with code that stays
 *    gained `export` in place in `sql-driver.ts` and are imported here:
 *    `crossFieldComparisonError` and `nowAnchorPositionError` (also thrown by
 *    the comparand classifier and by `applyFilterCondition`), `NowAnchor` (also
 *    read by `nowAnchorOf`), `fieldReferenceOf`, `mysqlDatetimeLiteral`,
 *    `withheldFilterError` (the #8220 seam every compile refusal goes
 *    through), `JSON_COLUMN_TYPES` and `NUMERIC_SCALAR_TYPES`.
 *
 * ## How the moved bodies reach the class
 *
 * The shape the other seam modules apply, after #23050. The class keeps every
 * method, because the published `dist/*.d.ts` lists each one's name,
 * docblock and position. Each method body is now one literal of exactly the
 * {@link CrossFieldComparisonHost} members that method reads, plus a `.call`.
 * Methods go as closures that call them on the driver at call time, so a
 * subclass override or an instance spy is still the one a body reaches; the
 * fields `isMysql` and `isSqlite` go as GETTERS, so each read happens when the
 * body makes it, as it did on the class.
 *
 * The module cycle is evaluation-safe because every value import from
 * `sql-driver.ts` is read only inside a function body, never while the two
 * modules are first evaluated. `index.ts` re-exports nothing from this module
 * and names its `sql-driver.ts` exports one by one, so the published surface
 * does not move.
 *
 * `sql-driver-compile-refusal-seam.test.ts` enumerates the filter-compile
 * refusal builders by parsing `sql-driver.ts` and this module together, so the
 * two refusal builders that moved are still counted as seam callers.
 */

import { temporalStorageForm } from '@objectstack/core';
// [#20355] The cross-field comparison class, defined once in the spec (#20347,
// lifted case for case from this driver's #5222 boundary). This driver READS it
// — `crossFieldComparisonClass` below delegates — so the read it compiles and
// the write check `@objectstack/formula` evaluates judge one comparison by one
// rule.
import { crossFieldColumnVerdict, type CrossFieldComparisonClass } from '@objectstack/spec/data';
import type { Knex } from 'knex';
import { crossFieldComparisonError, fieldReferenceOf, JSON_COLUMN_TYPES, mysqlDatetimeLiteral, type NowAnchor, nowAnchorPositionError, NUMERIC_SCALAR_TYPES, type SqlDriver, withheldFilterError } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface CrossFieldComparisonHost {
  crossFieldOffsetExpr: SqlDriver['crossFieldOffsetExpr'];
  declaredFieldsFor: SqlDriver['declaredFieldsFor'];
  filterColumnExpr: SqlDriver['filterColumnExpr'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly isSqlite: SqlDriver['isSqlite'];
  mapSortField: SqlDriver['mapSortField'];
  nowAnchorBaseExpr: SqlDriver['nowAnchorBaseExpr'];
  remoteColumn: SqlDriver['remoteColumn'];
  resolveTenantField: SqlDriver['resolveTenantField'];
}

/**
 * [#14104] The `addDays` operand a `{ $field }` reference carries — a
 * whole-day offset added to the referenced column before the comparison
 * (`FieldReferenceSchema.addDays`, `data/filter.zod.ts`):
 *
 *   - `null` — the reference carries no offset (the #5222 arm, unchanged);
 *   - `literal` — an integer, any sign (a negative value subtracts);
 *   - `column` — a nested `{ $field }` naming the numeric column that holds
 *     the days;
 *   - `invalid` — anything else. The schema door already refuses these; this
 *     driver refuses them again rather than binding the object as a literal,
 *     for the reason #5041 installed the first refusal: `find()` takes a
 *     `where` no face re-validates, and a permission filter assembled in code
 *     never passes the schema at all.
 *
 * Mirrors `@objectstack/formula`'s `resolveDayOffset` on WHAT an offset is;
 * the two differ only in what they do with one.
 */
type CrossFieldOffset =
  | { kind: 'literal'; days: number }
  | { kind: 'column'; ref: string }
  | { kind: 'invalid'; reason: string };

function fieldReferenceOffsetOf(value: unknown): CrossFieldOffset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).addDays;
  if (raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isInteger(raw)
      ? { kind: 'literal', days: raw }
      : { kind: 'invalid', reason: `addDays ${String(raw)} is not an integer (whole days only)` };
  }
  const nested = fieldReferenceOf(raw);
  if (nested !== null) return { kind: 'column', ref: nested };
  return {
    kind: 'invalid',
    reason: `addDays ${JSON.stringify(raw)} is neither an integer nor a { "$field": "numeric_column" } reference`,
  };
}

/**
 * [#25808] A `{ $now }` anchor in a scalar-comparison position this driver
 * cannot compile for the stated reason — the target column is not temporal, the
 * offset column breaks one of the #5222 rulings, the anchor is malformed. The
 * caller-visible message states the capability boundary and names nothing
 * (#7929); the diagnostic goes to the server log through the same withhold
 * {@link uncompilableFieldReferenceError} uses.
 */
function uncompilableNowAnchorError(field: string, op: string, reason: string, subtree?: unknown): Error {
  const diagnostic =
    `Operator "${op}" on field "${field}" compares against a now-anchored comparand ` +
    `({ "$now": true, "addDays": … }), which cannot be compiled here: ${reason}`;
  return withheldFilterError(
    `A now-anchored comparison ({ "$now": true, "addDays": … }) in this filter cannot be compiled ` +
      `here. On SQL push-down the anchor compares against a date or datetime column the object ` +
      `declares, and its addDays offset is an integer or a same-table numeric column the object ` +
      `declares, excluding the tenant-isolation column. The field, the operator this filter used ` +
      `and the specific reason are withheld from the message; the full diagnostic is in the server log.`,
    diagnostic,
    subtree,
  );
}

/**
 * [#5222] The comparison class a declared field's stored column belongs to, or
 * `null` for a field no column-to-column comparison can be compiled against.
 *
 * [#20355] The classification is the SPEC'S now — `crossFieldColumnVerdict`
 * (`@objectstack/spec/data`), lifted case for case from this function by
 * #20347 — and this function is its reader for the one thing the spec leaves
 * to a driver: its internal aliases. The write check (`@objectstack/formula`'s
 * `matchesFilterCondition`, handed the object's declared columns by the RLS
 * write gate) and the authoring door (`@objectstack/lint`) read the same
 * export, so a policy's comparison has one answer on the read, on the write
 * and at `os validate`. The reasoning below is the classification's, kept
 * here because this driver is where it was measured.
 *
 * Cross-field comparison is only emitted between two columns of the SAME
 * class. One class = one storage shape on both sides of one row, which is what
 * makes the SQL answer provably the memory evaluator's answer (the cross-path
 * conformance suite pins it).
 *
 * **The divergence is measured, not assumed — and it is DIRECTIONAL.** With
 * this check disabled, `{ stage: { $gt: { $field: 'amount' } } }` (TEXT target,
 * numeric referent) returns four rows on SQLite and NONE in memory: SQLite
 * orders by STORAGE CLASS first, so every TEXT sorts above every INTEGER,
 * while JS relational operators coerce `'won' > 10` to a NaN comparison and
 * answer false. The mirrored spelling `{ amount: { $gt: { $field: 'stage' } } }`
 * happens to agree (both answer nothing), and so does date-against-text — both
 * are TEXT on both paths, so they agree while answering by lexicographic
 * accident rather than by any temporal reading.
 *
 * The rule stays symmetric and covers the agreeing cells anyway, deliberately:
 * a guard that admitted exactly the pairings measured non-divergent on ONE
 * fixture would be a rule about this data rather than about the types, and the
 * agreeing cells are agreeing by coincidence of storage — a `boolean` column
 * holds `0/1` where the record holds `true/false`, and the three temporal
 * classes store three different text shapes (`YYYY-MM-DD` / canonical UTC ISO /
 * `HH:MM:SS`). Refusing a shape that would have agreed costs a caller an error
 * message; admitting one that diverges costs a permission rule its meaning.
 *
 * `null` — refused outright — for: `formula` (virtual, no column to
 * reference), every JSON-stored shape (`multiple: true` and the
 * {@link JSON_COLUMN_TYPES} classes — element-wise semantics SQL comparison
 * operators do not have), and anything else without a scalar stored form.
 *
 * ⚠️ The FILE family is refused BY NAME rather than by its old
 * {@link JSON_COLUMN_TYPES} membership, and the refusal is deployment-
 * independent on purpose. Once the family left that set its stored form became
 * a scalar string on a moved deployment — which would have made it `'text'`
 * here and newly ADMITTED a comparison this function has never emitted. During
 * the ADR-0104 dual-encoding window one media column can hold a bare id and
 * another the JSON-quoted form of the same id, so no column-to-column
 * comparison against the family is provably the memory evaluator's answer.
 * Refusing a shape that would have agreed costs a caller an error message,
 * which is the trade this function already states above.
 */
function crossFieldComparisonClass(
  decl: Record<string, unknown>,
): CrossFieldComparisonClass | null {
  const type = String((decl as { type?: unknown }).type || 'string');
  // [#20355] A declared `FieldType` is the spec's to classify — the one
  // classification the write check and the authoring door read too. Its
  // `multiple` reading is `isMultiValueField`'s, the same predicate
  // `isMultiValuedColumn` asks.
  const verdict = crossFieldColumnVerdict({ type, multiple: (decl as { multiple?: unknown }).multiple === true });
  if (verdict !== undefined) return verdict.kind === 'class' ? verdict.class : null;
  // A type outside `FieldType` is a driver-internal alias the spec does not
  // judge (its module header: "a driver layers its own aliases above this
  // table"). This driver's are read off its own column sets, never restated:
  // `object` / `array` are JSON columns ({@link JSON_COLUMN_TYPES}), `integer` /
  // `int` / `float` numeric ones ({@link NUMERIC_SCALAR_TYPES}), and everything
  // else — the absent-type default `string` included — is stored as TEXT.
  if (JSON_COLUMN_TYPES.has(type)) return null;
  if (NUMERIC_SCALAR_TYPES.has(type)) return 'numeric';
  return 'text';
}

/**
 * [#5222] A `{ $field }` reference at a compilable operator that fails the
 * v1 validation boundary — the maintainer's 2026-08-06 rulings on #5222,
 * verbatim: same-table columns only (dot paths refused — no JOIN planning, no
 * alias contract), declared-only enumeration (unknown columns refused at
 * compile time; external/federated tables, whose column sets this driver does
 * not own, refused wholesale), and the tenant-isolation column FORBIDDEN on
 * either side of the comparison. `reason` carries the specific sentence;
 * this wrapper keeps the envelope and the shared contract statement.
 *
 * [#7929] `reason` is SERVER-SIDE ONLY now, and it is the sharpest half of this
 * card's disclosure rather than an afterthought: those sentences name the
 * referenced column, the target column, the object and the declared types —
 * and, on the tenant arm, state WHICH column is the tenant-isolation column of
 * the object, a fact the platform otherwise keeps to itself. The shared
 * contract statement that followed it names nothing and stays on the wire, so a
 * caller still learns the capability boundary without learning this filter.
 */
function uncompilableFieldReferenceError(
  field: string,
  op: string,
  ref: string,
  reason: string,
  subtree?: unknown,
): Error {
  const diagnostic =
    `Operator "${op}" on field "${field}" compares against another field ` +
    `({ "$field": "${ref}" }), which cannot be compiled here: ${reason}`;
  return withheldFilterError(
    `A cross-field comparison ({ "$field": … }) in this filter cannot be compiled here. ` +
      `Cross-field comparison on SQL push-down supports same-table columns the object ` +
      `declares, compared as the same type class, excluding the tenant-isolation column. ` +
      `The columns, the operator this filter used and the specific reason are withheld from ` +
      `the message; the full diagnostic is in the server log.`,
    diagnostic,
    subtree,
  );
}

/** The body of `SqlDriver#applyCrossFieldComparison`; the method's docblock there is its contract. */
export function applyCrossFieldComparison(this: Pick<CrossFieldComparisonHost, 'crossFieldOffsetExpr' | 'declaredFieldsFor' | 'filterColumnExpr' | 'mapSortField' | 'remoteColumn' | 'resolveTenantField'>, builder: Knex.QueryBuilder, method: 'where' | 'orWhere', table: string | null, targetKey: string, targetLocalField: string, targetColumn: string, op: string, ref: string, refNode?: unknown): void {
  if (ref.includes('.')) {
    throw uncompilableFieldReferenceError(targetColumn, op, ref,
      `"${ref}" is a dotted path, and SQL push-down compiles same-table column references ` +
      `only (no relation traversal, no alias-qualified columns).`, refNode);
  }
  if (!table) {
    throw uncompilableFieldReferenceError(targetColumn, op, ref,
      `the target table of this query could not be resolved, so the reference cannot be ` +
      `checked against any declared column set.`, refNode);
  }
  const declared = this.declaredFieldsFor(table);
  if (!declared) {
    throw uncompilableFieldReferenceError(targetColumn, op, ref,
      `object "${table}" has no declared column set on this driver (an external/federated ` +
      `or unregistered table), so referenced column names cannot be validated.`, refNode);
  }
  const tenantField = this.resolveTenantField(table);
  if (tenantField !== null && (ref === tenantField || targetKey === tenantField || targetLocalField === tenantField)) {
    throw uncompilableFieldReferenceError(targetColumn, op, ref,
      `"${tenantField}" is the tenant-isolation column of "${table}", which must not appear ` +
      `on either side of a cross-field comparison.`, refNode);
  }
  const hasOwn = (name: string) => Object.prototype.hasOwnProperty.call(declared, name);
  const refDeclaredName = hasOwn(ref) ? ref : this.mapSortField(ref);
  if (!hasOwn(refDeclaredName)) {
    throw uncompilableFieldReferenceError(targetColumn, op, ref,
      `"${ref}" is not a declared field of "${table}" — only declared fields can be referenced.`, refNode);
  }
  const targetDeclaredName = hasOwn(targetKey) ? targetKey : targetLocalField;
  if (!hasOwn(targetDeclaredName)) {
    throw uncompilableFieldReferenceError(targetColumn, op, ref,
      `the target field "${targetKey}" is not a declared field of "${table}", so the two ` +
      `columns' types cannot be checked as comparable.`, refNode);
  }
  const refClass = crossFieldComparisonClass(declared[refDeclaredName] ?? {});
  const targetClass = crossFieldComparisonClass(declared[targetDeclaredName] ?? {});
  if (refClass === null) {
    throw uncompilableFieldReferenceError(targetColumn, op, ref,
      `"${ref}" (type "${String(declared[refDeclaredName]?.type ?? 'string')}"` +
      `${declared[refDeclaredName]?.multiple ? ', multiple' : ''}) has no scalar stored ` +
      `column a comparison can read.`, refNode);
  }
  if (targetClass === null) {
    throw uncompilableFieldReferenceError(targetColumn, op, ref,
      `the target field "${targetKey}" (type ` +
      `"${String(declared[targetDeclaredName]?.type ?? 'string')}"` +
      `${declared[targetDeclaredName]?.multiple ? ', multiple' : ''}) has no scalar stored ` +
      `column a comparison can read.`, refNode);
  }
  if (refClass !== targetClass) {
    throw uncompilableFieldReferenceError(targetColumn, op, ref,
      `"${targetKey}" is stored as ${targetClass} but "${ref}" as ${refClass}, and a ` +
      `cross-class comparison answers differently in SQL (storage-class ordering) than in ` +
      `memory (JS coercion) — compare same-class columns.`, refNode);
  }

  const refLocal = this.mapSortField(ref);
  const refColumn = this.remoteColumn(table, ref, refLocal);
  const lhs = this.filterColumnExpr(table, targetLocalField, targetColumn)
    ?? { sql: '??', bindings: [targetColumn] };
  const rhs = this.filterColumnExpr(table, refLocal, refColumn)
    ?? { sql: '??', bindings: [refColumn] };
  const raw = method === 'orWhere' ? 'orWhereRaw' : 'whereRaw';

  // [#14104] The whole-day offset, when the reference carries one.
  const offset = fieldReferenceOffsetOf(refNode);
  if (offset !== null) {
    if (offset.kind === 'invalid') {
      throw uncompilableFieldReferenceError(targetColumn, op, ref,
        `${offset.reason}; addDays is an integer literal of any sign or a { "$field" } reference ` +
        `to a numeric column.`, refNode);
    }
    if (refClass !== 'date' && refClass !== 'datetime') {
      throw uncompilableFieldReferenceError(targetColumn, op, ref,
        `addDays adds whole days to a date or datetime column, and "${ref}" is stored as ` +
        `${refClass} — an offset has no meaning on it.`, refNode);
    }
    let offsetOperand: { sql: string; bindings: any[] };
    if (offset.kind === 'literal') {
      offsetOperand = { sql: '?', bindings: [offset.days] };
    } else {
      const offsetRef = offset.ref;
      if (offsetRef.includes('.')) {
        throw uncompilableFieldReferenceError(targetColumn, op, ref,
          `the addDays offset "${offsetRef}" is a dotted path, and SQL push-down compiles ` +
          `same-table column references only (no relation traversal, no alias-qualified columns).`,
          refNode);
      }
      if (tenantField !== null && offsetRef === tenantField) {
        throw uncompilableFieldReferenceError(targetColumn, op, ref,
          `"${tenantField}" is the tenant-isolation column of "${table}", which must not appear ` +
          `in a cross-field comparison — not as the addDays offset either.`, refNode);
      }
      const offsetDeclaredName = hasOwn(offsetRef) ? offsetRef : this.mapSortField(offsetRef);
      if (!hasOwn(offsetDeclaredName)) {
        throw uncompilableFieldReferenceError(targetColumn, op, ref,
          `the addDays offset "${offsetRef}" is not a declared field of "${table}" — only ` +
          `declared fields can be referenced.`, refNode);
      }
      const offsetClass = crossFieldComparisonClass(declared[offsetDeclaredName] ?? {});
      if (offsetClass !== 'numeric') {
        throw uncompilableFieldReferenceError(targetColumn, op, ref,
          `the addDays offset "${offsetRef}" (type ` +
          `"${String(declared[offsetDeclaredName]?.type ?? 'string')}"` +
          `${declared[offsetDeclaredName]?.multiple ? ', multiple' : ''}) is not a numeric ` +
          `column, and a day offset must be a number of days.`, refNode);
      }
      const offsetLocal = this.mapSortField(offsetRef);
      offsetOperand = { sql: '??', bindings: [this.remoteColumn(table, offsetRef, offsetLocal)] };
    }
    const shifted = this.crossFieldOffsetExpr(rhs, offsetOperand, refClass);
    const A = lhs.sql;
    const B = rhs.sql;
    const Bx = shifted.sql;
    switch (op) {
      case '$eq':
        // Both sides must have a value AND agree; a NULL referenced column
        // is FALSE (no deadline), never the both-NULL match of the bare arm.
        (builder as any)[raw](
          `(${A} is not null and ${B} is not null and ${A} = ${Bx})`,
          [...lhs.bindings, ...rhs.bindings, ...lhs.bindings, ...shifted.bindings],
        );
        return;
      case '$ne':
        // The referenced column must have a value (else FALSE); then the
        // target either has none — `!looseEq(null, deadline)` is true in
        // memory — or differs from the shifted deadline.
        (builder as any)[raw](
          `(${B} is not null and (${A} is null or ${A} <> ${Bx}))`,
          [...rhs.bindings, ...lhs.bindings, ...lhs.bindings, ...shifted.bindings],
        );
        return;
      case '$gt':
      case '$gte':
      case '$lt':
      case '$lte': {
        const sqlOp = op === '$gt' ? '>' : op === '$gte' ? '>=' : op === '$lt' ? '<' : '<=';
        (builder as any)[raw](
          `(${A} is not null and ${B} is not null and ${A} ${sqlOp} ${Bx})`,
          [...lhs.bindings, ...rhs.bindings, ...lhs.bindings, ...shifted.bindings],
        );
        return;
      }
      default:
        // Unreachable: the call site gates on CROSS_FIELD_COMPARISON_OPERATORS.
        throw crossFieldComparisonError(targetColumn, op, ref, refNode);
    }
  }

  const A = lhs.sql;
  const B = rhs.sql;
  const ab = [...lhs.bindings, ...rhs.bindings];
  switch (op) {
    case '$eq':
      // Matches when both are NULL, or both have a value and the values
      // agree — `evalOp`'s `$eq` over a resolved reference, made total.
      (builder as any)[raw](
        `((${A} is null and ${B} is null) or (${A} is not null and ${B} is not null and ${A} = ${B}))`,
        [...ab, ...ab, ...ab],
      );
      break;
    case '$ne':
      // The exact complement of the `$eq` arm: exactly one side NULL, or
      // both valued and different.
      (builder as any)[raw](
        `((${A} is null and ${B} is not null) or (${A} is not null and ${B} is null) ` +
          `or (${A} is not null and ${B} is not null and ${A} <> ${B}))`,
        [...ab, ...ab, ...ab, ...ab],
      );
      break;
    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte': {
      // The orderings need both sides non-null (`evalOp`: `actual != null &&
      // v != null && …`). A bare `A > B` already DROPS null rows via
      // UNKNOWN; the explicit conjuncts are what make the predicate total,
      // so `$not` of it re-admits exactly those rows — the memory answer.
      const sqlOp = op === '$gt' ? '>' : op === '$gte' ? '>=' : op === '$lt' ? '<' : '<=';
      (builder as any)[raw](
        `(${A} is not null and ${B} is not null and ${A} ${sqlOp} ${B})`,
        [...ab, ...ab],
      );
      break;
    }
    default:
      // Unreachable: the call site gates on CROSS_FIELD_COMPARISON_OPERATORS.
      throw crossFieldComparisonError(targetColumn, op, ref, refNode);
  }
}

/** The body of `SqlDriver#applyNowAnchorComparison`; the method's docblock there is its contract. */
export function applyNowAnchorComparison(this: Pick<CrossFieldComparisonHost, 'crossFieldOffsetExpr' | 'declaredFieldsFor' | 'filterColumnExpr' | 'mapSortField' | 'nowAnchorBaseExpr' | 'remoteColumn' | 'resolveTenantField'>, builder: Knex.QueryBuilder, method: 'where' | 'orWhere', table: string | null, targetKey: string, targetLocalField: string, targetColumn: string, op: string, anchor: NowAnchor, node?: unknown): void {
  if (anchor.kind === 'invalid') {
    throw uncompilableNowAnchorError(targetColumn, op, `${anchor.reason}.`, node);
  }
  const offset = fieldReferenceOffsetOf(node);
  if (offset === null) {
    throw uncompilableNowAnchorError(targetColumn, op,
      `a { "$now": true } comparand must carry an addDays offset — an integer literal of any sign ` +
      `or a { "$field" } reference to a numeric column; for the unshifted instant write the "{now}" ` +
      `placeholder.`, node);
  }
  if (offset.kind === 'invalid') {
    throw uncompilableNowAnchorError(targetColumn, op,
      `${offset.reason}; addDays is an integer literal of any sign or a { "$field" } reference ` +
      `to a numeric column.`, node);
  }
  if (!table) {
    throw uncompilableNowAnchorError(targetColumn, op,
      `the target table of this query could not be resolved, so the target column's type ` +
      `cannot be read.`, node);
  }
  const declared = this.declaredFieldsFor(table);
  if (!declared) {
    throw uncompilableNowAnchorError(targetColumn, op,
      `object "${table}" has no declared column set on this driver (an external/federated ` +
      `or unregistered table), so the target column's type cannot be read.`, node);
  }
  const hasOwn = (name: string) => Object.prototype.hasOwnProperty.call(declared, name);
  const tenantField = this.resolveTenantField(table);
  if (tenantField !== null && (targetKey === tenantField || targetLocalField === tenantField)) {
    throw uncompilableNowAnchorError(targetColumn, op,
      `"${tenantField}" is the tenant-isolation column of "${table}", which must not be the ` +
      `target of a now-anchored comparison.`, node);
  }
  const targetDeclaredName = hasOwn(targetKey) ? targetKey : targetLocalField;
  if (!hasOwn(targetDeclaredName)) {
    throw uncompilableNowAnchorError(targetColumn, op,
      `the target field "${targetKey}" is not a declared field of "${table}", so its type ` +
      `cannot be checked as temporal.`, node);
  }
  const targetClass = crossFieldComparisonClass(declared[targetDeclaredName] ?? {});
  if (targetClass !== 'date' && targetClass !== 'datetime') {
    throw uncompilableNowAnchorError(targetColumn, op,
      `a now-anchored comparand is an instant shifted by whole days, and the target field ` +
      `"${targetKey}" (type "${String(declared[targetDeclaredName]?.type ?? 'string')}"` +
      `${declared[targetDeclaredName]?.multiple ? ', multiple' : ''}) is stored as ` +
      `${targetClass ?? 'no scalar column'} — only a date or datetime column can be compared ` +
      `against it.`, node);
  }

  let offsetOperand: { sql: string; bindings: any[] };
  if (offset.kind === 'literal') {
    offsetOperand = { sql: '?', bindings: [offset.days] };
  } else {
    const offsetRef = offset.ref;
    if (offsetRef.includes('.')) {
      throw uncompilableNowAnchorError(targetColumn, op,
        `the addDays offset "${offsetRef}" is a dotted path, and SQL push-down compiles ` +
        `same-table column references only (no relation traversal, no alias-qualified columns).`,
        node);
    }
    if (tenantField !== null && offsetRef === tenantField) {
      throw uncompilableNowAnchorError(targetColumn, op,
        `"${tenantField}" is the tenant-isolation column of "${table}", which must not appear ` +
        `in a cross-field comparison — not as the addDays offset either.`, node);
    }
    const offsetDeclaredName = hasOwn(offsetRef) ? offsetRef : this.mapSortField(offsetRef);
    if (!hasOwn(offsetDeclaredName)) {
      throw uncompilableNowAnchorError(targetColumn, op,
        `the addDays offset "${offsetRef}" is not a declared field of "${table}" — only ` +
        `declared fields can be referenced.`, node);
    }
    const offsetClass = crossFieldComparisonClass(declared[offsetDeclaredName] ?? {});
    if (offsetClass !== 'numeric') {
      throw uncompilableNowAnchorError(targetColumn, op,
        `the addDays offset "${offsetRef}" (type ` +
        `"${String(declared[offsetDeclaredName]?.type ?? 'string')}"` +
        `${declared[offsetDeclaredName]?.multiple ? ', multiple' : ''}) is not a numeric ` +
        `column, and a day offset must be a number of days.`, node);
    }
    const offsetLocal = this.mapSortField(offsetRef);
    offsetOperand = { sql: '??', bindings: [this.remoteColumn(table, offsetRef, offsetLocal)] };
  }

  const lhs = this.filterColumnExpr(table, targetLocalField, targetColumn)
    ?? { sql: '??', bindings: [targetColumn] };
  const base = this.nowAnchorBaseExpr(anchor.at, targetClass);
  const shifted = this.crossFieldOffsetExpr(base, offsetOperand, targetClass);
  const raw = method === 'orWhere' ? 'orWhereRaw' : 'whereRaw';
  const A = lhs.sql;
  const Bx = shifted.sql;
  switch (op) {
    case '$eq':
      (builder as any)[raw](`(${A} is not null and ${A} = ${Bx})`, [...lhs.bindings, ...lhs.bindings, ...shifted.bindings]);
      return;
    case '$ne':
      (builder as any)[raw](`(${A} is null or ${A} <> ${Bx})`, [...lhs.bindings, ...lhs.bindings, ...shifted.bindings]);
      return;
    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte': {
      const sqlOp = op === '$gt' ? '>' : op === '$gte' ? '>=' : op === '$lt' ? '<' : '<=';
      (builder as any)[raw](
        `(${A} is not null and ${A} ${sqlOp} ${Bx})`,
        [...lhs.bindings, ...lhs.bindings, ...shifted.bindings],
      );
      return;
    }
    default:
      // Unreachable: the call site gates on CROSS_FIELD_COMPARISON_OPERATORS.
      throw nowAnchorPositionError(targetColumn, op, node);
  }
}

/** The body of `SqlDriver#nowAnchorBaseExpr`; the method's docblock there is its contract. */
export function nowAnchorBaseExpr(this: Pick<CrossFieldComparisonHost, 'isMysql' | 'isSqlite'>, at: Date, cls: 'date' | 'datetime'): { sql: string; bindings: any[] } {
  if (cls === 'date') {
    const day = temporalStorageForm(at, 'date');
    if (this.isSqlite) return { sql: '?', bindings: [day] };
    return { sql: 'cast(? as date)', bindings: [day] };
  }
  const instant = at.toISOString();
  if (this.isSqlite) return { sql: '?', bindings: [instant] };
  if (this.isMysql) return { sql: 'cast(? as datetime(3))', bindings: [mysqlDatetimeLiteral(instant)] };
  return { sql: 'cast(? as timestamptz)', bindings: [instant] };
}

/** The body of `SqlDriver#crossFieldOffsetExpr`; the method's docblock there is its contract. */
export function crossFieldOffsetExpr(this: Pick<CrossFieldComparisonHost, 'isMysql' | 'isSqlite'>, base: { sql: string; bindings: any[] }, offset: { sql: string; bindings: any[] }, cls: 'date' | 'datetime'): { sql: string; bindings: any[] } {
  const bindings = [...base.bindings, ...offset.bindings];
  if (this.isSqlite) {
    const modifier = `(cast(coalesce(${offset.sql}, 0) as integer) || ' days')`;
    return cls === 'date'
      ? { sql: `date(${base.sql}, ${modifier})`, bindings }
      : { sql: `strftime('%Y-%m-%dT%H:%M:%fZ', ${base.sql}, ${modifier})`, bindings };
  }
  if (this.isMysql) {
    return {
      sql: `date_add(${base.sql}, interval cast(truncate(coalesce(${offset.sql}, 0), 0) as signed) day)`,
      bindings,
    };
  }
  // Postgres (and any dialect with SQL-standard interval arithmetic).
  const days = `cast(trunc(coalesce(${offset.sql}, 0)) as integer)`;
  return cls === 'date'
    ? { sql: `(${base.sql} + ${days})`, bindings }
    : { sql: `(${base.sql} + make_interval(days => ${days}))`, bindings };
}
