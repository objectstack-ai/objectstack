// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Filter helpers" section of `SqlDriver`: the bodies of
 * `tableNameForBuilder`, `coercionKey`, `toDateOnly`, `toTimeOnly`,
 * `coerceFilterValue`, `storageDatetimeValue`, `needsLegacyDatetimeRepair`,
 * `sqliteCanonicalDatetimeSql`, `sqliteNonTemporalTextSql`,
 * `needsLegacyTimeRepair`, `sqliteCanonicalTimeSql`, `temporalFieldKind`,
 * `readPresentationKind`, `presentReadValue`, `presentReadColumns`,
 * `sqliteTemporalArg`, `filterColumnExpr`, `temporalFilterValue`,
 * `temporalFilterColumnSql`, `isJsonColumn`, `jsonColumnFieldClass`,
 * `isNonTextColumn`, `applyTextOperatorOverNonTextColumn`,
 * `declaredValueShape`, `assertOperatorAppliesToColumn`, `applyFilters`,
 * `resolveWithheldFilterRefusal`, `logWithheldFilterDiagnostic`,
 * `withWithheldFilterLog`, `compileFilters`, `applyContainsLike`,
 * `declaredFieldsFor`, `applyFalseConstant` moved out of `sql-driver.ts` whole
 * by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link FilterHelpersFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link FilterHelpersHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `filterHelpersHost` in
 * `sql-driver-facet-hosts.ts`, built once per driver by the class's static
 * block. Methods go as closures that call them on the driver at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * driver.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { resolveFilterSubtreeProvenance } from '@objectstack/spec/data';
import type { DriverOptions, ValueShapeFieldDef } from '@objectstack/spec/data';
import { JSON_COLUMN_INCOMPATIBLE_OPERATORS, findMisplacedReadableIds, presentAsNumber, refuseReadableIdsOnce, temporalStorageForm } from '@objectstack/core';
import type { JsonColumnFieldClass } from '@objectstack/core';
import { StorageNameMapping } from '@objectstack/spec/system';
import type { Knex } from 'knex';
import {
  AUDIT_TIMESTAMP_COLUMNS, SQLITE_TIME_EXPR_REFS, WITHHELD_FILTER_AUTHOR_TEXT, WITHHELD_FILTER_LOGGED,
  WITHHELD_FILTER_SUBTREE, assertCompilableComparand, assertDefinedComparands, canonicalTimeOfDay,
  canonicalUtcDatetime, emptyFieldConstraintError, filterArrayReachedDriverError, isEmptyFieldConstraint,
  jsonColumnOperatorError, mysqlDatetimeLiteral, normalizeSqliteDatetimeOutput, presentAuditTimestampOutput,
  refusalSubtree, unsupportedFilterError, withheldFilterDiagnosticOf,
} from './sql-driver-top-level.js';
import type { ReadPresentationKind } from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link FilterHelpersFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface FilterHelpersHost {
  applyFalseConstant: SqlDriver['applyFalseConstant'];
  applyFilterCondition: SqlDriver['applyFilterCondition'];
  applyLike: SqlDriver['applyLike'];
  applyNormalizedComparison: SqlDriver['applyNormalizedComparison'];
  assertOperatorAppliesToColumn: SqlDriver['assertOperatorAppliesToColumn'];
  readonly booleanFields: SqlDriver['booleanFields'];
  readonly canonicalDatetimeFields: SqlDriver['canonicalDatetimeFields'];
  readonly canonicalTimeFields: SqlDriver['canonicalTimeFields'];
  coerceFilterValue: SqlDriver['coerceFilterValue'];
  coercionKey: SqlDriver['coercionKey'];
  compileFilters: SqlDriver['compileFilters'];
  readonly dateFields: SqlDriver['dateFields'];
  readonly datetimeFields: SqlDriver['datetimeFields'];
  filterColumnExpr: SqlDriver['filterColumnExpr'];
  isJsonColumn: SqlDriver['isJsonColumn'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly isSqlite: SqlDriver['isSqlite'];
  jsonColumnFieldClass: SqlDriver['jsonColumnFieldClass'];
  readonly jsonFields: SqlDriver['jsonFields'];
  logWithheldFilterDiagnostic: SqlDriver['logWithheldFilterDiagnostic'];
  readonly logger: SqlDriver['logger'];
  readonly managedObjectFields: SqlDriver['managedObjectFields'];
  readonly mediaFields: SqlDriver['mediaFields'];
  needsLegacyDatetimeRepair: SqlDriver['needsLegacyDatetimeRepair'];
  needsLegacyTimeRepair: SqlDriver['needsLegacyTimeRepair'];
  readonly numericFields: SqlDriver['numericFields'];
  readonly objectByPhysicalTable: SqlDriver['objectByPhysicalTable'];
  presentReadValue: SqlDriver['presentReadValue'];
  readonly readableIdsDriverName: SqlDriver['readableIdsDriverName'];
  readonly readableIdsRefusalLog: SqlDriver['readableIdsRefusalLog'];
  remoteColumn: SqlDriver['remoteColumn'];
  resolveWithheldFilterRefusal: SqlDriver['resolveWithheldFilterRefusal'];
  sqliteCanonicalDatetimeSql: SqlDriver['sqliteCanonicalDatetimeSql'];
  sqliteCanonicalTimeSql: SqlDriver['sqliteCanonicalTimeSql'];
  storageDatetimeValue: SqlDriver['storageDatetimeValue'];
  tableNameForBuilder: SqlDriver['tableNameForBuilder'];
  temporalFieldKind: SqlDriver['temporalFieldKind'];
  readonly timeFields: SqlDriver['timeFields'];
  toDateOnly: SqlDriver['toDateOnly'];
  toTimeOnly: SqlDriver['toTimeOnly'];
  readonly valueShapeFields: SqlDriver['valueShapeFields'];
}

/** The bodies of the "Filter helpers" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class FilterHelpersFacet {
  /** The body of `SqlDriver#tableNameForBuilder`; the method's docblock there is its contract. */
  static tableNameForBuilder(builder: any): string | null {
    const t = builder?._single?.table;
    if (typeof t === 'string') return t;
    return null;
  }

  /** The body of `SqlDriver#coercionKey`; the method's docblock there is its contract. */
  static coercionKey(this: Pick<FilterHelpersHost, 'objectByPhysicalTable' | 'tableNameForBuilder'>, builder: any): string | null {
    const physical = this.tableNameForBuilder(builder);
    if (physical == null) return null;
    return this.objectByPhysicalTable[physical] ?? physical;
  }

  /** The body of `SqlDriver#toDateOnly`; the method's docblock there is its contract. */
  static toDateOnly(value: any): any {
    // [#20176] The rule — UTC getters included — is `@objectstack/core`'s
    // `temporalStorageForm`, the function `driver-memory` and the engine's
    // per-aggregation `filter` / `having` read too; this body was a copy of it.
    return temporalStorageForm(value, 'date');
  }

  /** The body of `SqlDriver#toTimeOnly`; the method's docblock there is its contract. */
  static toTimeOnly(value: any): any {
    return canonicalTimeOfDay(value);
  }

  /** The body of `SqlDriver#coerceFilterValue`; the method's docblock there is its contract. */
  static coerceFilterValue(this: Pick<FilterHelpersHost, 'coerceFilterValue' | 'storageDatetimeValue' | 'temporalFieldKind' | 'toDateOnly'>, table: string | null, field: string, value: any): any {
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

  /** The body of `SqlDriver#storageDatetimeValue`; the method's docblock there is its contract. */
  static storageDatetimeValue(this: Pick<FilterHelpersHost, 'isMysql'>, value: unknown): unknown {
    const canonical = canonicalUtcDatetime(value);
    return this.isMysql ? mysqlDatetimeLiteral(canonical) : canonical;
  }

  /** The body of `SqlDriver#needsLegacyDatetimeRepair`; the method's docblock there is its contract. */
  static needsLegacyDatetimeRepair(this: Pick<FilterHelpersHost, 'canonicalDatetimeFields' | 'datetimeFields' | 'isSqlite'>, table: string | null | undefined, field: string): boolean {
    if (!table || !this.isSqlite) return false;
    if (this.datetimeFields[table]?.has(field) !== true) return false;
    return this.canonicalDatetimeFields[table]?.has(field) !== true;
  }

  /** The body of `SqlDriver#sqliteCanonicalDatetimeSql`; the method's docblock there is its contract. */
  static sqliteCanonicalDatetimeSql(columnSql: string): string {
    return (
      `(case when typeof(${columnSql}) in ('integer','real') ` +
      `then strftime('%Y-%m-%dT%H:%M:%fZ', ${columnSql}/1000.0, 'unixepoch') ` +
      `else coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', ${columnSql}), ${columnSql}) end)`
    );
  }

  /** The body of `SqlDriver#sqliteNonTemporalTextSql`; the method's docblock there is its contract. */
  static sqliteNonTemporalTextSql(columnSql: string): string {
    return (
      `(typeof(${columnSql}) not in ('integer','real') ` +
      `and instr(${columnSql}, '-') = 0 and instr(${columnSql}, ':') = 0 ` +
      `and julianday(${columnSql}) is not null)`
    );
  }

  /** The body of `SqlDriver#needsLegacyTimeRepair`; the method's docblock there is its contract. */
  static needsLegacyTimeRepair(this: Pick<FilterHelpersHost, 'canonicalTimeFields' | 'isSqlite' | 'timeFields'>, table: string | null | undefined, field: string): boolean {
    if (!table || !this.isSqlite) return false;
    if (this.timeFields[table]?.has(field) !== true) return false;
    return this.canonicalTimeFields[table]?.has(field) !== true;
  }

  /** The body of `SqlDriver#sqliteCanonicalTimeSql`; the method's docblock there is its contract. */
  static sqliteCanonicalTimeSql(columnSql: string): string {
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

  /** The body of `SqlDriver#temporalFieldKind`; the method's docblock there is its contract. */
  static temporalFieldKind(this: Pick<FilterHelpersHost, 'dateFields' | 'datetimeFields' | 'timeFields'>, table: string | null | undefined, field: string): 'datetime' | 'date' | 'time' | null {
    if (!table) return null;
    if (this.datetimeFields[table]?.has(field)) return 'datetime';
    if (this.dateFields[table]?.has(field)) return 'date';
    if (this.timeFields[table]?.has(field)) return 'time';
    return null;
  }

  /** The body of `SqlDriver#readPresentationKind`; the method's docblock there is its contract. */
  static readPresentationKind(this: Pick<FilterHelpersHost, 'booleanFields' | 'isMysql' | 'isSqlite' | 'numericFields' | 'temporalFieldKind'>, table: string | null | undefined, field: string): ReadPresentationKind | null {
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
  static presentReadValue(this: Pick<FilterHelpersHost, 'toDateOnly' | 'toTimeOnly'>, kind: ReadPresentationKind, value: any): any {
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
  static presentReadColumns(this: Pick<FilterHelpersHost, 'presentReadValue'>, rows: any, columns: Map<string, ReadPresentationKind>): any {
    if (columns.size === 0 || !Array.isArray(rows)) return rows;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const [column, kind] of columns) {
        if (row[column] !== undefined) row[column] = this.presentReadValue(kind, row[column]);
      }
    }
    return rows;
  }

  /** The body of `SqlDriver#sqliteTemporalArg`; the method's docblock there is its contract. */
  static sqliteTemporalArg(this: Pick<FilterHelpersHost, 'needsLegacyDatetimeRepair' | 'sqliteCanonicalDatetimeSql'>, field: string, table: string | null | undefined): { sql: string; bindings: any[] } {
    if (!this.needsLegacyDatetimeRepair(table, field)) return { sql: '??', bindings: [field] };
    return { sql: this.sqliteCanonicalDatetimeSql('??'), bindings: [field, field, field, field] };
  }

  /** The body of `SqlDriver#filterColumnExpr`; the method's docblock there is its contract. */
  static filterColumnExpr(this: Pick<FilterHelpersHost, 'needsLegacyDatetimeRepair' | 'needsLegacyTimeRepair' | 'sqliteCanonicalDatetimeSql' | 'sqliteCanonicalTimeSql'>, table: string | null | undefined, field: string, column: string): { sql: string; bindings: any[] } | null {
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

  /** The body of `SqlDriver#temporalFilterValue`; the method's docblock there is its contract. */
  static temporalFilterValue(this: Pick<FilterHelpersHost, 'coerceFilterValue'>, objectName: string, field: string, value: any): unknown {
    return this.coerceFilterValue(objectName, field, value);
  }

  /** The body of `SqlDriver#temporalFilterColumnSql`; the method's docblock there is its contract. */
  static temporalFilterColumnSql(this: Pick<FilterHelpersHost, 'needsLegacyDatetimeRepair' | 'needsLegacyTimeRepair' | 'sqliteCanonicalDatetimeSql' | 'sqliteCanonicalTimeSql'>, objectName: string, field: string, columnSql: string): string {
    if (this.needsLegacyDatetimeRepair(objectName, field)) {
      return this.sqliteCanonicalDatetimeSql(columnSql);
    }
    if (this.needsLegacyTimeRepair(objectName, field)) {
      return this.sqliteCanonicalTimeSql(columnSql);
    }
    return columnSql;
  }

  /** The body of `SqlDriver#isJsonColumn`; the method's docblock there is its contract. */
  static isJsonColumn(this: Pick<FilterHelpersHost, 'jsonFields'>, table: string | null | undefined, localField: string): boolean {
    if (!table) return false;
    return this.jsonFields[table]?.includes(localField) === true;
  }

  /** The body of `SqlDriver#jsonColumnFieldClass`; the method's docblock there is its contract. */
  static jsonColumnFieldClass(this: Pick<FilterHelpersHost, 'isJsonColumn' | 'mediaFields'>, table: string | null | undefined, localField: string): JsonColumnFieldClass | undefined {
    if (!table || !this.isJsonColumn(table, localField)) return undefined;
    return this.mediaFields[table]?.includes(localField) === true ? 'single-value-media' : 'multi-value-or-json';
  }

  /** The body of `SqlDriver#isNonTextColumn`; the method's docblock there is its contract. */
  static isNonTextColumn(this: Pick<FilterHelpersHost, 'booleanFields' | 'isJsonColumn' | 'numericFields' | 'temporalFieldKind'>, table: string | null | undefined, localField: string): boolean {
    if (!table) return false;
    return (
      this.numericFields[table]?.includes(localField) === true ||
      (this.booleanFields[table]?.includes(localField) === true && !this.isJsonColumn(table, localField)) ||
      (this.temporalFieldKind(table, localField) !== null && !this.isJsonColumn(table, localField))
    );
  }

  /**
   * [#14079] Emit the DECLARED answer for a text operator aimed at a column
   * whose stored value is never text ({@link isNonTextColumn}): the positive
   * operators (`$contains` / `$startsWith` / `$endsWith` / `$icontains` /
   * `$like` / `$ilike`) compile to the FALSE constant — no row's number
   * contains a substring — and `$notContains` to the TRUE constant, its exact
   * complement. `FILTER_TEXT_CASES`' `score` rows are the pin, on every face.
   *
   * # What compiled before, per dialect — three answers to one filter
   *
   * Measured on `origin/main` over a `Field.number` column holding `5`
   * (#14079): the SQLite dialects compiled `col GLOB '*5*'` and COERCED the
   * REAL to text in the storage class's own spelling (`'5.0'`, so
   * `$contains: '.0'` matched and `$endsWith: '5'` did not); live Postgres
   * compiled `col LIKE $1 ESCAPE $2` and REFUSED at query time with SQLSTATE
   * 42883 (`operator does not exist: real ~~ text`) — a 500 for a filter the
   * spec accepts; MySQL's `CAST(col AS BINARY) LIKE ?` reads as coercion (not
   * executed — no server was provisionable). The maintainer ruled the cell on
   * 2026-09-05 (option A, type-gate; coercion refused on the measurement) and
   * the constants are that ruling compiled: the same row set on every dialect,
   * decided by the DECLARED type at compile time because the stored value is
   * not visible until run time.
   *
   * # Why constants compose with the NULL rules rather than fight them
   *
   * A row with no value already satisfies `$notContains` (#5298,
   * {@link SqlDriver.applyNullSafeNegative}) and fails every positive
   * operator, so `1 = 1` / `1 = 0` agree with the null polarity on every row —
   * there is no cell where the two rules disagree. Under `$not` the leaf is
   * totalised first (the shared lowering's rule 3, at the seams): `NOT (col IS NOT NULL
   * AND 1 = 0)` is TRUE for every row, which is what the JS faces answer for
   * `!contains` on a number, and `NOT (col IS NULL OR 1 = 1)` is FALSE for
   * every row, what they answer for `!notContains`. Complementarity holds
   * through the negation too.
   *
   * Every refusal stays AHEAD of this: the comparand gates on the validating
   * walk (`reduceFilterKey`: an empty or non-string `$icontains` comparand, a
   * non-string or dangling `$like` pattern) and {@link assertCompilableComparand}
   * all run before the caller reaches here, so a filter the contract refuses
   * is still refused — the constant answers only a filter the contract
   * accepts. `1 = 0` is {@link applyFalseConstant}'s spelling; `1 = 1` is its
   * mirror, valid on every dialect this driver targets and free of bindings.
   */
  static applyTextOperatorOverNonTextColumn(this: Pick<FilterHelpersHost, 'applyFalseConstant'>, builder: any, logicalOp: 'and' | 'or', op: string): void {
    if (op === '$notContains') {
      builder[logicalOp === 'or' ? 'orWhereRaw' : 'whereRaw']('1 = 1');
      return;
    }
    this.applyFalseConstant(builder, logicalOp);
  }

  /** The body of `SqlDriver#declaredValueShape`; the method's docblock there is its contract. */
  static declaredValueShape(this: Pick<FilterHelpersHost, 'valueShapeFields'>, table: string | null | undefined, localField: string): ValueShapeFieldDef | undefined {
    if (!table) return undefined;
    const shapes = this.valueShapeFields[table];
    return shapes && Object.prototype.hasOwnProperty.call(shapes, localField) ? shapes[localField] : undefined;
  }

  /** The body of `SqlDriver#assertOperatorAppliesToColumn`; the method's docblock there is its contract. */
  static assertOperatorAppliesToColumn(this: Pick<FilterHelpersHost, 'jsonColumnFieldClass'>,
    table: string | null | undefined,
    localField: string,
    column: string,
    op: string,
    bare = false,
    // [#8197] The filter node this constraint was read from, so the refusal can
    // be resolved against the query's `where` root like every other withheld
    // one. Optional, and absent means WITHHELD — a subclass that overrides this
    // method without threading it degrades onto the fail-closed branch rather
    // than onto the disclosing one.
    subtree?: unknown,
  ): void {
    if (!JSON_COLUMN_INCOMPATIBLE_OPERATORS.has(op)) return;
    // [#21236] The same JSON-column question {@link isJsonColumn} answers, with
    // the column's class beside it, so the refusal names the class's repair.
    const fieldClass = this.jsonColumnFieldClass(table, localField);
    if (fieldClass === undefined) return;
    throw jsonColumnOperatorError(column, op, bare, fieldClass, subtree);
  }

  /** The body of `SqlDriver#applyFilters`; the method's docblock there is its contract. */
  static applyFilters(this: Pick<FilterHelpersHost, 'compileFilters' | 'logger' | 'readableIdsDriverName' | 'readableIdsRefusalLog' | 'resolveWithheldFilterRefusal'>, builder: Knex.QueryBuilder, filters: any, options?: DriverOptions) {
    // [ADR-0139 D3] A `ReadableIds` leaf this compiler will not evaluate — an
    // UNCOMPOSED one anywhere, a composed one outside a `$in` comparand — is
    // refused before anything compiles: INTERNAL_ERROR / 500, logged at
    // `error` once per driver. ⛔ Never evaluated as "no restriction".
    const misplaced = findMisplacedReadableIds(filters, true);
    if (misplaced) throw refuseReadableIdsOnce(this.readableIdsDriverName, misplaced, this.logger, this.readableIdsRefusalLog);
    try {
      this.compileFilters(builder, filters, options);
    } catch (err) {
      throw this.resolveWithheldFilterRefusal(err, filters);
    }
  }

  /** The body of `SqlDriver#resolveWithheldFilterRefusal`; the method's docblock there is its contract. */
  static resolveWithheldFilterRefusal(this: Pick<FilterHelpersHost, 'logWithheldFilterDiagnostic'>, err: unknown, rootFilter: unknown): unknown {
    const diagnostic = withheldFilterDiagnosticOf(err);
    if (diagnostic === null) return err;
    const carrier = err as Record<symbol, unknown>;
    const subtree = carrier[WITHHELD_FILTER_SUBTREE];
    const provenance =
      subtree === undefined ? null : resolveFilterSubtreeProvenance(rootFilter, subtree);
    if (provenance === 'author') {
      const authorText = carrier[WITHHELD_FILTER_AUTHOR_TEXT];
      return unsupportedFilterError(typeof authorText === 'string' ? authorText : diagnostic);
    }
    this.logWithheldFilterDiagnostic(err);
    return err;
  }

  /** The body of `SqlDriver#logWithheldFilterDiagnostic`; the method's docblock there is its contract. */
  static logWithheldFilterDiagnostic(this: Pick<FilterHelpersHost, 'logger'>, err: unknown): void {
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

  /** The body of `SqlDriver#withWithheldFilterLog`; the method's docblock there is its contract. */
  static withWithheldFilterLog<T>(this: Pick<FilterHelpersHost, 'resolveWithheldFilterRefusal'>, rootFilter: unknown, fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      // [#8220] The same provenance resolution `applyFilters` applies, against
      // the same `where` ROOT — threaded into this frame because a lazily
      // invoked group callback is past that entry point's catch. Resolving
      // against the local branch instead would lose every mark set on an
      // ANCESTOR (the merge boundaries mark the arms of their own `$and`), so
      // an author's nested `$or` refusal would stay redacted for no reason.
      throw this.resolveWithheldFilterRefusal(err, rootFilter);
    }
  }

  /** The body of `SqlDriver#compileFilters`; the method's docblock there is its contract. */
  static compileFilters(this: Pick<FilterHelpersHost, 'applyFilterCondition' | 'applyNormalizedComparison' | 'assertOperatorAppliesToColumn' | 'coerceFilterValue' | 'coercionKey' | 'filterColumnExpr' | 'remoteColumn'>, builder: Knex.QueryBuilder, filters: any, options?: DriverOptions) {
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

  /**
   * Apply a `contains` substring match as a parameterized `LIKE '%…%'`, escaping
   * the LIKE metacharacters `%` / `_` (and the escape char `\`) in the user value
   * so they match literally instead of acting as wildcards — otherwise a value of
   * `%` matches every row (a filter-bypass, P0). Binds an explicit `ESCAPE '\'`
   * because SQLite does not honour a default escape character (MySQL/Postgres do,
   * but the explicit clause is correct for all three).
   */
  static applyContainsLike(this: Pick<FilterHelpersHost, 'applyLike'>, builder: any, method: string, field: string, value: unknown): void {
    this.applyLike(builder, method, field, value, 'contains');
  }

  /** The body of `SqlDriver#declaredFieldsFor`; the method's docblock there is its contract. */
  static declaredFieldsFor(this: Pick<FilterHelpersHost, 'managedObjectFields'>, object: string): Record<string, any> | undefined {
    const tableName = StorageNameMapping.resolveTableName({ name: object } as any);
    return this.managedObjectFields.get(tableName) ?? this.managedObjectFields.get(object);
  }

  /**
   * [#5134] Emit the dialect FALSE constant — a predicate that matches no row.
   *
   * `1 = 0` is the spelling already used for this condition on both sides of the
   * repo: `read-scope-sql.ts` compiles an empty `$in` to it, and Knex itself
   * renders an empty `whereIn` as `1 = 0`. It is valid on every dialect this
   * driver targets (unlike a bare `FALSE`, which MySQL accepts but older SQL
   * Server does not), needs no bindings, and keeps the query a normal SELECT so
   * `LIMIT`/`ORDER BY`/aggregates all still behave.
   */
  static applyFalseConstant(builder: any, logicalOp: 'and' | 'or'): void {
    builder[logicalOp === 'or' ? 'orWhereRaw' : 'whereRaw']('1 = 0');
  }
}
