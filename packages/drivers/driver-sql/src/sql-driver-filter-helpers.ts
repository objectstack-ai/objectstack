// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Filter helpers" section of `SqlDriver`: the bodies of
 * `tableNameForBuilder`, `toDateOnly`, `coerceFilterValue`,
 * `sqliteCanonicalDatetimeSql`, `sqliteNonTemporalTextSql`,
 * `sqliteCanonicalTimeSql`, `readPresentationKind`, `presentReadValue`,
 * `presentReadColumns`, `filterColumnExpr`, `logWithheldFilterDiagnostic`,
 * `compileFilters` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link FilterHelpersHost}: exactly the
 * `SqlDriver` members they read. Each method hands its body one literal of the
 * members that body reads, plus a `.call`: methods go as closures that call
 * them on the driver at call time (the builder factory as a bound reference),
 * so a subclass override or an instance spy is still the one reached; fields
 * and accessors go as GETTERS, read when the body reads them, as they were on
 * the class.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form
 * no evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { DriverOptions } from '@objectstack/spec/data';
import { presentAsNumber, temporalStorageForm } from '@objectstack/core';
import type { Knex } from 'knex';
import {
  AUDIT_TIMESTAMP_COLUMNS, SQLITE_TIME_EXPR_REFS, WITHHELD_FILTER_LOGGED, assertCompilableComparand,
  assertDefinedComparands, canonicalTimeOfDay, emptyFieldConstraintError, filterArrayReachedDriverError,
  isEmptyFieldConstraint, normalizeSqliteDatetimeOutput, presentAuditTimestampOutput, refusalSubtree,
  withheldFilterDiagnosticOf,
} from './sql-driver-top-level.js';
import type { ReadPresentationKind } from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface FilterHelpersHost {
  applyFilterCondition: SqlDriver['applyFilterCondition'];
  applyNormalizedComparison: SqlDriver['applyNormalizedComparison'];
  assertOperatorAppliesToColumn: SqlDriver['assertOperatorAppliesToColumn'];
  readonly booleanFields: SqlDriver['booleanFields'];
  coerceFilterValue: SqlDriver['coerceFilterValue'];
  coercionKey: SqlDriver['coercionKey'];
  filterColumnExpr: SqlDriver['filterColumnExpr'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly isSqlite: SqlDriver['isSqlite'];
  readonly logger: SqlDriver['logger'];
  needsLegacyDatetimeRepair: SqlDriver['needsLegacyDatetimeRepair'];
  needsLegacyTimeRepair: SqlDriver['needsLegacyTimeRepair'];
  readonly numericFields: SqlDriver['numericFields'];
  presentReadValue: SqlDriver['presentReadValue'];
  remoteColumn: SqlDriver['remoteColumn'];
  sqliteCanonicalDatetimeSql: SqlDriver['sqliteCanonicalDatetimeSql'];
  sqliteCanonicalTimeSql: SqlDriver['sqliteCanonicalTimeSql'];
  storageDatetimeValue: SqlDriver['storageDatetimeValue'];
  temporalFieldKind: SqlDriver['temporalFieldKind'];
  toDateOnly: SqlDriver['toDateOnly'];
  toTimeOnly: SqlDriver['toTimeOnly'];
}

/** The body of `SqlDriver#tableNameForBuilder`; the method's docblock there is its contract. */
export function tableNameForBuilder(builder: any): string | null {
    const t = builder?._single?.table;
    if (typeof t === 'string') return t;
    return null;
  }

/** The body of `SqlDriver#toDateOnly`; the method's docblock there is its contract. */
export function toDateOnly(value: any): any {
    // [#20176] The rule — UTC getters included — is `@objectstack/core`'s
    // `temporalStorageForm`, the function `driver-memory` and the engine's
    // per-aggregation `filter` / `having` read too; this body was a copy of it.
    return temporalStorageForm(value, 'date');
  }

/** The body of `SqlDriver#coerceFilterValue`; the method's docblock there is its contract. */
export function coerceFilterValue(this: Pick<FilterHelpersHost, 'coerceFilterValue' | 'storageDatetimeValue' | 'temporalFieldKind' | 'toDateOnly'>, table: string | null, field: string, value: any): any {
    if (value == null || !table) return value;
    if (Array.isArray(value)) return value.map((v) => this.coerceFilterValue(table, field, v));

    const kind = this.temporalFieldKind(table, field);
    if (!kind) return value;
    if (kind === 'datetime') return this.storageDatetimeValue(value);
    // `Field.time` (#3994) takes the same treatment for the same reason: the
    // comparand must be the canonical time-of-day text the column stores.
    if (kind === 'time') return canonicalTimeOfDay(value);
    return this.toDateOnly(value);
  }

/** The body of `SqlDriver#sqliteCanonicalDatetimeSql`; the method's docblock there is its contract. */
export function sqliteCanonicalDatetimeSql(columnSql: string): string {
    return (
      `(case when typeof(${columnSql}) in ('integer','real') ` +
      `then strftime('%Y-%m-%dT%H:%M:%fZ', ${columnSql}/1000.0, 'unixepoch') ` +
      `else coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', ${columnSql}), ${columnSql}) end)`
    );
  }

/** The body of `SqlDriver#sqliteNonTemporalTextSql`; the method's docblock there is its contract. */
export function sqliteNonTemporalTextSql(columnSql: string): string {
    return (
      `(typeof(${columnSql}) not in ('integer','real') ` +
      `and instr(${columnSql}, '-') = 0 and instr(${columnSql}, ':') = 0 ` +
      `and julianday(${columnSql}) is not null)`
    );
  }

/** The body of `SqlDriver#sqliteCanonicalTimeSql`; the method's docblock there is its contract. */
export function sqliteCanonicalTimeSql(columnSql: string): string {
    const canonText = (args: string) =>
      `case when strftime('%H:%M:%f', ${args}) like '%.000' ` +
      `then strftime('%H:%M:%S', ${args}) ` +
      `else strftime('%H:%M:%f', ${args}) end`;
    return (
      `(case when typeof(${columnSql}) in ('integer','real') ` +
      `then ${canonText(`${columnSql}/1000.0, 'unixepoch'`)} ` +
      `else coalesce(${canonText(columnSql)}, ${columnSql}) end)`
    );
  }

/** The body of `SqlDriver#readPresentationKind`; the method's docblock there is its contract. */
export function readPresentationKind(this: Pick<FilterHelpersHost, 'booleanFields' | 'isMysql' | 'isSqlite' | 'numericFields' | 'temporalFieldKind'>, table: string | null | undefined, field: string): ReadPresentationKind | null {
    if (!table) return null;
    const temporal = this.temporalFieldKind(table, field);
    if (temporal) return temporal;
    if ((AUDIT_TIMESTAMP_COLUMNS as readonly string[]).includes(field)) return 'audit_timestamp';
    if ((this.isSqlite || this.isMysql) && this.booleanFields[table]?.includes(field)) {
      return 'boolean';
    }
    // [#16318] Every dialect, for the reason `formatOutput`'s own numeric pass
    // records: an exact-decimal column is handed back as a STRING by
    // node-postgres and by mysql2, so `aggregate()` / `distinct()` would present
    // a declared numeric field as a string on exactly the dialects `find()` now
    // presents it as a number. One class, one answer, on every door.
    if (this.numericFields[table]?.includes(field)) return 'number';
    return null;
  }

/** The body of `SqlDriver#presentReadValue`; the method's docblock there is its contract. */
export function presentReadValue(this: Pick<FilterHelpersHost, 'toDateOnly' | 'toTimeOnly'>, kind: ReadPresentationKind, value: any): any {
    if (value == null) return value;
    switch (kind) {
      case 'date':
        return this.toDateOnly(value);
      case 'time':
        // Every dialect, like `date`: canonicalising also re-pads the fraction
        // Postgres trims (`.5` → `.500`), so `distinct()`/`aggregate()` present
        // exactly what `find()` presents (#3994, the F6 gap of the #3849 fix).
        return this.toTimeOnly(value);
      case 'datetime':
        // Every dialect ([ADR-0053 D-F1]): the same fold `formatOutput` applies
        // to a `find()` row, so `min`/`max`/`distinct` over a declared
        // `Field.datetime` (the audit columns too, when the engine declares
        // them so) present the canonical text and never the client's `Date`.
        return normalizeSqliteDatetimeOutput(value);
      case 'audit_timestamp':
        // Every dialect ([ADR-0053 D-F1]): the ONE presenter `formatOutput`
        // applies to `created_at` / `updated_at` — a `Date` folds to the
        // canonical text, a zone-naive legacy string is repaired (ADR-0074),
        // and a number passes through as it does on a `find()` row (ADR-0074
        // §3) — so `max(created_at)` and `distinct('updated_at')` answer the
        // value `find()` answers, type for type. `normalizeSqliteDatetimeOutput`
        // would fold the number too, and did between #13973's first cut and
        // its contract review: an author-declared `created_at: number` read
        // `1700000000000` off `find()` and `"2023-11-14T22:13:20.000Z"` off
        // `distinct()` — the divergence the conformance file's §D pins closed.
        return presentAuditTimestampOutput(value);
      case 'boolean':
        return Boolean(value);
      case 'number':
        // [#20889] The presenter lives in `@objectstack/core`, beside
        // `AGGREGATE_ANSWER_KIND`, so the analytics native-SQL face presents
        // a count or a total with this same function.
        return presentAsNumber(value);
    }
  }

/** The body of `SqlDriver#presentReadColumns`; the method's docblock there is its contract. */
export function presentReadColumns(this: Pick<FilterHelpersHost, 'presentReadValue'>, rows: any, columns: Map<string, ReadPresentationKind>): any {
    if (columns.size === 0 || !Array.isArray(rows)) return rows;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const [column, kind] of columns) {
        if (row[column] !== undefined) row[column] = this.presentReadValue(kind, row[column]);
      }
    }
    return rows;
  }

/** The body of `SqlDriver#filterColumnExpr`; the method's docblock there is its contract. */
export function filterColumnExpr(this: Pick<FilterHelpersHost, 'needsLegacyDatetimeRepair' | 'needsLegacyTimeRepair' | 'sqliteCanonicalDatetimeSql' | 'sqliteCanonicalTimeSql'>, table: string | null | undefined, field: string, column: string): { sql: string; bindings: any[] } | null {
    if (this.needsLegacyDatetimeRepair(table, field)) {
      return {
        sql: this.sqliteCanonicalDatetimeSql('??'),
        bindings: [column, column, column, column],
      };
    }
    if (this.needsLegacyTimeRepair(table, field)) {
      return {
        sql: this.sqliteCanonicalTimeSql('??'),
        bindings: Array(SQLITE_TIME_EXPR_REFS).fill(column),
      };
    }
    return null;
  }

/** The body of `SqlDriver#logWithheldFilterDiagnostic`; the method's docblock there is its contract. */
export function logWithheldFilterDiagnostic(this: Pick<FilterHelpersHost, 'logger'>, err: unknown): void {
    const diagnostic = withheldFilterDiagnosticOf(err);
    if (diagnostic === null) return;
    const marked = err as Record<symbol, unknown>;
    if (marked[WITHHELD_FILTER_LOGGED] === true) return;
    Object.defineProperty(err as object, WITHHELD_FILTER_LOGGED, { value: true, enumerable: false });
    // [#8197] The wording no longer says "cross-field reference refused": this
    // seam now carries the target-field family too, and a log line that names
    // the wrong refusal class sends the operator reading it to the wrong part
    // of the filter. What it states instead is the fact that is true of every
    // line it writes — the predicate was not positively marked author-written,
    // so the naming half went here rather than to the caller.
    this.logger.warn(
      `[sql-driver] INVALID_FILTER — refusal detail withheld from the response because the ` +
        `predicate was not positively marked as author-written. ` +
        `Full diagnostic: ${diagnostic}`,
    );
  }

/** The body of `SqlDriver#compileFilters`; the method's docblock there is its contract. */
export function compileFilters(this: Pick<FilterHelpersHost, 'applyFilterCondition' | 'applyNormalizedComparison' | 'assertOperatorAppliesToColumn' | 'coerceFilterValue' | 'coercionKey' | 'filterColumnExpr' | 'remoteColumn'>, builder: Knex.QueryBuilder, filters: any, options?: DriverOptions) {
    if (!filters) return;

    // [#5158] `where` is a `FilterCondition` OBJECT. It always was — the spec
    // declares `QueryASTSchema.where: FilterConditionSchema` — but this method
    // used to carry a SECOND compiler for the array spelling, including an
    // INFIX dialect (`[condA, 'or', condB]`) that no schema ever declared and
    // that `parseFilterAST` cannot express. `FilterArray` is now declared as
    // INPUT-ONLY authoring sugar (`spec/data/filter.zod.ts`, #5285) and BOTH
    // doors into the runtime lower it before a driver is reached: the protocol
    // face (`metadata-protocol`) and the engine (`ObjectQL.find`/`findOne`/
    // `count`/`aggregate`/`update`/`delete`). So an array here is a bug in the
    // caller, not a dialect to compile — and refusing it is what converges this
    // driver with cloud's `RemoteTransport.buildWhereSQL`, which has refused
    // the same input since cloud#1075. That fork had zero tests on either side.
    if (Array.isArray(filters)) {
      // `[]` keeps its meaning — "no filter", not a failed filter. Unchanged
      // from every previous version of this method, and the same reading
      // `parseFilterAST([])` gives it.
      if (filters.length === 0) return;
      // [#20039] The array IS the `where` root, so its own mark is its verdict.
      throw filterArrayReachedDriverError(filters);
    }

    const table = this.coercionKey(builder);

    if (typeof filters === 'object') {
      const hasMongoOperators = Object.keys(filters).some(
        (k) =>
          k.startsWith('$') ||
          (typeof filters[k] === 'object' &&
            filters[k] !== null &&
            Object.keys(filters[k]).some((op) => op.startsWith('$'))),
      );

      if (hasMongoOperators) {
        this.applyFilterCondition(builder, filters, 'and', table, filters, options);
        return;
      }

      for (const [key, value] of Object.entries(filters)) {
        if (['limit', 'offset', 'fields', 'orderBy'].includes(key)) continue;
        const column = this.remoteColumn(table, key, key);
        // #5240 — `{ field: {} }` reaches this loop when NO key of the filter
        // carries an operator; the combinator path refuses it on the reduction
        // walk. Refused here with the SAME message so one condition has one
        // wording wherever the author wrote it — this position used to answer
        // with #5041's generic "cannot be bound as a SQL parameter", which
        // describes a comparand and not a constraint with no operator at all.
        if (isEmptyFieldConstraint(value)) {
          throw emptyFieldConstraintError(key, `filter.${key}`, value);
        }
        // #6050 — the same position as the `undefined` gate on the reduction
        // walk, reached the same way `{ field: {} }` above reaches its own: this
        // loop runs when NO key of the filter carries an operator, so the walk
        // never sees the node. `{ d: undefined }` IS that shape — `typeof
        // undefined` is not `'object'`, so it cannot make `hasMongoOperators`
        // true — and it is the single most likely spelling of the defect
        // (`{ owner_id: ctx.user?.id }`). ONE function answers both call sites
        // so the two positions cannot drift into two verdicts, which is the
        // #5240 lesson this driver already paid for once.
        // [#20039] `filters` is the node carrying `key`, as for the gate below.
        assertDefinedComparands(key, value, `filter.${key}`, filters);
        // #5041 — the plain `{ field: value }` map compiles to an implicit `=`,
        // so it is a comparison emitter too and gets the same gate.
        // [#8197] `filters` is both this loop's node and the query's `where`
        // root — this branch runs only when NO key carries an operator, so
        // there is no nearer enclosing node to hand over.
        assertCompilableComparand(column, '=', value, filters);
        // #7398 — and the column-type question the comparand gate cannot ask.
        // This loop IS the bare `{ field: value }` spelling, one of the four
        // the issue measured as silently answering zero rows on an array column.
        this.assertOperatorAppliesToColumn(table, key, column, '=', true, refusalSubtree(value, filters));
        const coerced = this.coerceFilterValue(table, key, value);
        const expr = this.filterColumnExpr(table, key, column);
        if (expr && this.applyNormalizedComparison(builder, 'and', expr, '=', coerced)) continue;
        builder.where(column, coerced as any);
      }
      return;
    }

    // A truthy non-object, non-array `where` (`'active'`, `42`) emits no
    // predicate. Pre-existing behaviour on a shape only a cast can produce —
    // the protocol face rejects it (`unusableFilterError`) and `FilterCondition`
    // does not describe it. Untouched here on purpose: #5158 is about the ARRAY
    // dialect, and widening the refusal is a separate change with its own
    // blast radius.
  }
