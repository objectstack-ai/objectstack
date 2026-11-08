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
 * `applyFilterCondition`, `declaredFieldsFor`, `applyFalseConstant` moved out
 * of `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
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

import { isComposedReadableIds, resolveFilterSubtreeProvenance } from '@objectstack/spec/data';
import type { DriverOptions, ValueShapeFieldDef } from '@objectstack/spec/data';
import { JSON_COLUMN_INCOMPATIBLE_OPERATORS, findMisplacedReadableIds, presentAsNumber, refuseReadableIdsOnce, temporalStorageForm } from '@objectstack/core';
import type { JsonColumnFieldClass } from '@objectstack/core';
import { StorageNameMapping } from '@objectstack/spec/system';
import { emitBalancedGroup } from './sql-driver-balanced-group.js';
import type { Knex } from 'knex';
import {
  AUDIT_TIMESTAMP_COLUMNS, CROSS_FIELD_COMPARISON_OPERATORS, SQLITE_TIME_EXPR_REFS, TEXT_OPERATORS,
  WITHHELD_FILTER_AUTHOR_TEXT, WITHHELD_FILTER_LOGGED, WITHHELD_FILTER_SUBTREE, assertCompilableComparand,
  assertDefinedComparands, bareFieldReferenceError, betweenArityError, canonicalTimeOfDay, canonicalUtcDatetime,
  emptyFieldConstraintError, fieldReferenceOf, filterArrayReachedDriverError, isEmptyFieldConstraint, isFilterNode,
  jsonColumnOperatorError, mysqlDatetimeLiteral, normalizeSqliteDatetimeOutput, nowAnchorOf, nowAnchorPositionError,
  presentAuditTimestampOutput, reduceFilterKey, reduceFilterNode, refusalSubtree, retiredFilterOperatorError,
  unsupportedFilterError, unsupportedFilterOperatorError, withheldFilterDiagnosticOf,
} from './sql-driver-top-level.js';
import { assertOracleComparandNotEmptyString, oracleDayBinding, oracleInstantBinding } from './sql-driver-oracle-dialect.js';
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
  applyContainsLike: SqlDriver['applyContainsLike'];
  applyCrossFieldComparison: SqlDriver['applyCrossFieldComparison'];
  applyEmptyOperator: SqlDriver['applyEmptyOperator'];
  applyFalseConstant: SqlDriver['applyFalseConstant'];
  applyFilterCondition: SqlDriver['applyFilterCondition'];
  applyJsonMembership: SqlDriver['applyJsonMembership'];
  applyLike: SqlDriver['applyLike'];
  applyLikePattern: SqlDriver['applyLikePattern'];
  applyNormalizedComparison: SqlDriver['applyNormalizedComparison'];
  applyNowAnchorComparison: SqlDriver['applyNowAnchorComparison'];
  applyNullSafeNegative: SqlDriver['applyNullSafeNegative'];
  applyTextOperatorOverNonTextColumn: SqlDriver['applyTextOperatorOverNonTextColumn'];
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
  isNonTextColumn: SqlDriver['isNonTextColumn'];
  readonly isOracle: SqlDriver['isOracle'];
  readonly isSqlite: SqlDriver['isSqlite'];
  jsonColumnFieldClass: SqlDriver['jsonColumnFieldClass'];
  readonly jsonFields: SqlDriver['jsonFields'];
  logWithheldFilterDiagnostic: SqlDriver['logWithheldFilterDiagnostic'];
  readonly logger: SqlDriver['logger'];
  readonly managedObjectFields: SqlDriver['managedObjectFields'];
  mapSortField: SqlDriver['mapSortField'];
  readonly mediaFields: SqlDriver['mediaFields'];
  needsLegacyDatetimeRepair: SqlDriver['needsLegacyDatetimeRepair'];
  needsLegacyTimeRepair: SqlDriver['needsLegacyTimeRepair'];
  readonly numericFields: SqlDriver['numericFields'];
  readonly objectByPhysicalTable: SqlDriver['objectByPhysicalTable'];
  presentReadValue: SqlDriver['presentReadValue'];
  readonly readableIdsDriverName: SqlDriver['readableIdsDriverName'];
  readonly readableIdsRefusalLog: SqlDriver['readableIdsRefusalLog'];
  readableIdsSubquery: SqlDriver['readableIdsSubquery'];
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
  withWithheldFilterLog: SqlDriver['withWithheldFilterLog'];
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
  static coerceFilterValue(this: Pick<FilterHelpersHost, 'coerceFilterValue' | 'isOracle' | 'storageDatetimeValue' | 'temporalFieldKind' | 'toDateOnly'>, table: string | null, field: string, value: any): any {
    if (value == null || !table) return value;
    if (Array.isArray(value)) return value.map((v) => this.coerceFilterValue(table, field, v));

    const kind = this.temporalFieldKind(table, field);
    if (!kind) return value;
    if (kind === 'datetime') return this.storageDatetimeValue(value);
    // `Field.time` (#3994) takes the same treatment for the same reason: the
    // comparand must be the canonical time-of-day text the column stores.
    if (kind === 'time') return canonicalTimeOfDay(value);
    const day = this.toDateOnly(value);
    // Oracle has no date-only type and parses no text into a `DATE` without an
    // NLS format: the calendar day is bound as the instant its UTC midnight
    // names (see `oracleDayBinding`).
    return this.isOracle ? oracleDayBinding(day) : day;
  }

  /** The body of `SqlDriver#storageDatetimeValue`; the method's docblock there is its contract. */
  static storageDatetimeValue(this: Pick<FilterHelpersHost, 'isMysql' | 'isOracle'>, value: unknown): unknown {
    const canonical = canonicalUtcDatetime(value);
    if (this.isOracle) return oracleInstantBinding(canonical);
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
  static readPresentationKind(this: Pick<FilterHelpersHost, 'booleanFields' | 'isMysql' | 'isOracle' | 'isSqlite' | 'numericFields' | 'temporalFieldKind'>, table: string | null | undefined, field: string): ReadPresentationKind | null {
    if (!table) return null;
    const temporal = this.temporalFieldKind(table, field);
    if (temporal) return temporal;
    if ((AUDIT_TIMESTAMP_COLUMNS as readonly string[]).includes(field)) return 'audit_timestamp';
    // Oracle before 23ai has no BOOLEAN: a declared boolean over a `NUMBER(1)`
    // / `CHAR(1)` flag column reads `1` / `0` and is presented here, like the
    // integer flags of SQLite and MySQL. (A `CHAR(1)` `'Y'`/`'N'` column is not
    // a boolean column — the type matrix says so at import, never this line.)
    if ((this.isSqlite || this.isMysql || this.isOracle) && this.booleanFields[table]?.includes(field)) {
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
  static compileFilters(this: Pick<FilterHelpersHost, 'applyFilterCondition' | 'applyNormalizedComparison' | 'assertOperatorAppliesToColumn' | 'coerceFilterValue' | 'coercionKey' | 'filterColumnExpr' | 'isOracle' | 'remoteColumn'>, builder: Knex.QueryBuilder, filters: any, options?: DriverOptions) {
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
        if (this.isOracle) assertOracleComparandNotEmptyString('=', key, value, refusalSubtree(value, filters));
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

  /** The body of `SqlDriver#applyFilterCondition`; the method's docblock there is its contract. */
  static applyFilterCondition(this: Pick<FilterHelpersHost, 'applyContainsLike' | 'applyCrossFieldComparison' | 'applyEmptyOperator' | 'applyFalseConstant' | 'applyFilterCondition' | 'applyJsonMembership' | 'applyLike' | 'applyLikePattern' | 'applyNormalizedComparison' | 'applyNowAnchorComparison' | 'applyNullSafeNegative' | 'applyTextOperatorOverNonTextColumn' | 'assertOperatorAppliesToColumn' | 'coerceFilterValue' | 'coercionKey' | 'filterColumnExpr' | 'isNonTextColumn' | 'isOracle' | 'mapSortField' | 'readableIdsSubquery' | 'remoteColumn' | 'withWithheldFilterLog'>,
    builder: Knex.QueryBuilder,
    condition: any,
    logicalOp: 'and' | 'or' = 'and',
    tableHint?: string | null,
    // [#8220] The query's `where` ROOT, threaded so the lazily invoked group
    // callbacks below can resolve a refusal's provenance against the tree the
    // merge boundaries actually marked. Defaults to this frame's own
    // `condition` for any direct caller compiling a standalone tree.
    rootFilter?: unknown,
    // [ADR-0139 D3] The OUTER read's options, threaded down every combinator so
    // a composed `ReadableIds` leaf's subquery is tenant-walled by
    // {@link applyTenantScope} with exactly the options the outer read was
    // scoped with — captured by the lazily invoked group callbacks below,
    // never read from instance state.
    options?: DriverOptions,
  ) {
    if (!condition || typeof condition !== 'object') return;
    const root = rootFilter ?? condition;
    const table = tableHint ?? this.coercionKey(builder);

    // #5134 — shape-validate the whole tree and decide its boolean value first.
    // A malformed node throws here, before any identity is applied, so "compiled
    // to empty" can only ever mean "genuinely empty".
    const verdict = reduceFilterNode(condition as Record<string, unknown>, 'filter');
    if (verdict === 'true') return;
    if (verdict === 'false') {
      this.applyFalseConstant(builder, logicalOp);
      return;
    }

    for (const [key, value] of Object.entries(condition)) {
      if (key === '$and' && Array.isArray(value)) {
        // #5134 — an all-TRUE `$and` (including `$and: []`) IS the AND identity;
        // emitting nothing for it is now a decision, not an accident. A FALSE
        // member cannot reach here: it would have made the node FALSE above.
        if (reduceFilterKey(key, value, 'filter', condition) === 'true') continue;
        const branches = value.filter(
          (sub) => reduceFilterNode(sub as Record<string, unknown>, 'filter') === 'clause',
        );
        // Attach this group to the parent the way `logicalOp` asks, matching
        // `$or`/`$not` below. Nothing passes 'or' today (the sole caller uses
        // 'and' and no branch propagates 'or' any more), but leaving one of the
        // four combinators deaf to the flag is how the rules drift apart again.
        const method = logicalOp === 'or' ? 'orWhere' : 'where';
        // [#29888] A large group is regrouped into balanced halves, so the
        // expression tree it parses to stays shallow (sql-driver-balanced-group.ts).
        (builder as any)[method]((qb: any) => {
          emitBalancedGroup(qb, branches, 'where', (subQb: any, sub) => {
            this.withWithheldFilterLog(root, () => this.applyFilterCondition(subQb, sub, 'and', table, root, options));
          });
        });
      } else if (key === '$or' && Array.isArray(value)) {
        // #5134 — one TRUE disjunct makes the whole `$or` TRUE, so `{$or:[{a},{}]}`
        // matches every row instead of quietly compiling to just `(a = ?)`.
        if (reduceFilterKey(key, value, 'filter', condition) === 'true') continue;
        // FALSE disjuncts are the OR identity — dropped. At least one `'clause'`
        // member survives, or the key would have been TRUE/FALSE above.
        const branches = value.filter(
          (sub) => reduceFilterNode(sub as Record<string, unknown>, 'filter') === 'clause',
        );
        const method = logicalOp === 'or' ? 'orWhere' : 'where';
        (builder as any)[method]((qb: any) => {
          // The `'orWhere'` attach is what OR-s the branches together.
          // The branch body is still compiled with 'and', because every key
          // inside one filter object is AND-ed at every depth (Filter
          // Protocol / Mongo). Passing 'or' down instead made a branch's own
          // field keys OR each other, so `{$or:[{a,b}]}` compiled to
          // `a = ? OR b = ?`. That widens the result set, so an RLS/sharing
          // read scope of the shape `{$or:[{owner,status},{shared_with}]}`
          // returned rows the scope excluded — see sql-driver-or-filter.test.ts.
          // [#29888] A large group is regrouped into balanced halves, so the
          // expression tree it parses to stays shallow: the parent-record read
          // gates OR one branch per registered parent object, and a flat chain
          // of them passed SQLite's expression-depth limit on hosted libSQL
          // (sql-driver-balanced-group.ts).
          emitBalancedGroup(qb, branches, 'orWhere', (subQb: any, sub) => {
            this.withWithheldFilterLog(root, () => this.applyFilterCondition(subQb, sub, 'and', table, root, options));
          });
        });
      } else if (key === '$not') {
        // Spec LOGICAL_OPERATORS declares `$not` alongside `$and`/`$or`; both
        // driver-mongodb and driver-memory implement it, and CEL `!expr` in a
        // permission/scope rule compiles to `{ $not: {...} }` (cel-to-filter.ts).
        // Without this branch `$not` fell through to the field handler, was
        // treated as a column named "$not", and produced wrong SQL — the same
        // class of silent filter-bypass this fix (issue #2704) closes.
        //
        // #5134 — `$not` of a FALSE group is TRUE: skip it. `$not` of a TRUE
        // group is FALSE and never reaches here (the node reduced to FALSE), and
        // a non-node operand was refused by the reduction, so `value` is a node.
        if (reduceFilterKey(key, value, 'filter', condition) === 'true') continue;
        // #5146 — the operand is negated as handed. On every seamed read it is
        // already TOTAL: the shared lowering guarded each leaf in the direction
        // its operator answers for a row with no value (ADR-0053 D-D1, amended;
        // the lowering's rule 3), so `NOT (…)` is its exact complement. This
        // driver's own copy of that rewrite is deleted (#20822, item 5): a
        // caller that passes no seam gets the three-valued `NOT` it wrote.
        const notMethod = logicalOp === 'or' ? 'orWhereNot' : 'whereNot';
        (builder as any)[notMethod]((qb: any) => {
          // [#8220] The operand is the caller's own node (a seam's lowering
          // carries each rewritten node's provenance mark forward), so a
          // refusal raised inside a `$not` resolves against `root` like any
          // other; the walk-side refusals ran on the same nodes, eagerly.
          this.withWithheldFilterLog(root, () =>
            this.applyFilterCondition(qb, value as Record<string, unknown>, 'and', table, root, options),
          );
        });
      } else if (isFilterNode(value)) {
        // [#19885] An OPERATOR MAP is a plain object — the walk's own reading
        // ({@link isFilterNode}, which {@link classifyFilterKey} and the
        // top-level `{ field: value }` loop in `compileFilters` agree with). This
        // test used to be "any non-array object", so a `Date` or binary comparand
        // landed here and was read as an operator map, with a different wrong
        // answer per shape:
        //
        // - a `Date` has no own entries, so its leaf was DROPPED:
        //   `{ $and: [{ d: <Date> }] }` answered every row on SQLite and Postgres
        //   while the same `{ d: <Date> }` at top level answered the one matching row;
        // - a NON-EMPTY binary comparand (`Buffer` / `Uint8Array`) had its byte
        //   indices read as operator names, so it was REFUSED — `INVALID_FILTER` /
        //   400, `Unsupported filter operator "0"` — a comparand the top level binds;
        // - an EMPTY binary comparand has no entries either, so it was dropped
        //   like the `Date`.
        //
        // Each is a comparand, and it now takes the bare-value branch below, the
        // same compilation the top-level loop gives it.
        const localField = this.mapSortField(key);
        const field = this.remoteColumn(table, key, localField);
        // Non-null only for a SQLite `Field.datetime`, whose two stored forms
        // (INTEGER epoch / ISO TEXT) must be unified before comparing (#3912).
        const columnExpr = this.filterColumnExpr(table, localField, field);
        for (const [rawOp, opValue] of Object.entries(value as Record<string, any>)) {
          const method = logicalOp === 'or' ? 'orWhere' : 'where';
          // [ADR-0139 D3] The composed `ReadableIds` leaf — the one non-list a
          // `$in` may hold — compiles to the semi-join, ahead of every comparand
          // gate below (none of which has a reading for it). Only `$in` reaches
          // here: `applyFilters` refused it at every other position.
          if (rawOp === '$in' && isComposedReadableIds(opValue)) {
            const mIn = logicalOp === 'or' ? 'orWhereIn' : 'whereIn';
            (builder as any)[mIn](field, this.readableIdsSubquery(opValue, options));
            continue;
          }
          // #5222 — a `{ $field }` that is the WHOLE comparand of a scalar
          // comparison compiles to a same-table column-to-column comparison
          // (or refuses inside the emitter, with the specific boundary named).
          // Checked before the #5041 gate below, which still answers every
          // other `$field` position — list members, the LIKE family — and
          // before coercion/rewrites, which expect a literal comparand.
          // #5222 — the bare `{ field: { $field: 'other' } }` spelling reaches
          // this loop as an OPERATOR named `$field`, because the whole field
          // spec is its own operator map. Answered here, ahead of the generic
          // unsupported-operator arm, so the message can name the supported
          // spelling instead of listing fifteen operator names.
          if (rawOp === '$field' && typeof opValue === 'string') {
            // [#8220] `value` — the field-spec map carrying the bare `$field`
            // key — is the node the provenance resolver can find in the tree;
            // `opValue` is only the referenced column's name.
            throw bareFieldReferenceError(field, opValue, value);
          }
          const crossFieldRef = fieldReferenceOf(opValue);
          if (crossFieldRef !== null && CROSS_FIELD_COMPARISON_OPERATORS.has(rawOp)) {
            this.applyCrossFieldComparison(builder, method, table, key, localField, field, rawOp, crossFieldRef, opValue);
            continue;
          }
          // [#25808] The bare `{ field: { $now: true, addDays } }` spelling reaches
          // this loop as an operator named `$now`, as the bare `$field` does.
          if (rawOp === '$now') throw nowAnchorPositionError(field, rawOp, value);
          // [#25808] A `{ $now, addDays }` anchor that is the WHOLE comparand of a
          // scalar comparison compiles to `column <op> <instant + days>` (or
          // refuses inside the emitter, with the boundary named). Same slot as
          // the `{ $field }` arm above, for the same reasons.
          const nowAnchor = nowAnchorOf(opValue);
          if (nowAnchor !== null && CROSS_FIELD_COMPARISON_OPERATORS.has(rawOp)) {
            this.applyNowAnchorComparison(builder, method, table, key, localField, field, rawOp, nowAnchor, opValue);
            continue;
          }
          // #5041 — reject a comparand that cannot become a bind parameter
          // BEFORE any rewrite or coercion touches it, so the message names the
          // shape the caller actually sent.
          // [#8197] `value` — this field's operator map — is the enclosing node
          // for both gates below: the nearest node to the constraint that is
          // guaranteed to be an object, and therefore markable.
          assertCompilableComparand(field, rawOp, opValue, value);
          // #7398 — the column-type gate, on the operator AS WRITTEN and ahead
          // of every rewrite and both emitters, so a JSON column cannot reach
          // the plain `whereIn` arms below NOR the normalised `whereRaw` arms
          // an external multi-value datetime column is routed to.
          this.assertOperatorAppliesToColumn(table, localField, field, rawOp, false, value);
          // [#14079] The type-gated answer for a text operator over a column
          // whose stored value is never text — AFTER every refusal above (a
          // filter the contract refuses is still refused) and BEFORE both
          // emitters, so neither a `GLOB` nor a `LIKE` is ever built against a
          // number. See {@link SqlDriver.applyTextOperatorOverNonTextColumn}.
          if (TEXT_OPERATORS.has(rawOp) && this.isNonTextColumn(table, localField)) {
            this.applyTextOperatorOverNonTextColumn(builder, logicalOp, rawOp);
            continue;
          }
          // [#20444] `$empty` — answered by the field's DECLARED row of the
          // ruled table, AFTER every refusal above (its non-boolean comparand
          // was refused on the walk) and BEFORE the comparand coercion and the
          // normalised-column emitter: its flag is not a value of the column,
          // so neither applies.
          if (rawOp === '$empty') {
            this.applyEmptyOperator(builder, logicalOp, table, localField, field, opValue === true, value);
            continue;
          }
          // [ADR-0053 D-D1 items 5 and 9, as amended — #20822] No calendar-day
          // rewrite here: a bare-day `$lte` / `$between` max is widened to the
          // whole day ONCE, by the shared lowering (`lowerFilterCondition`,
          // `@objectstack/spec/data`) at the seams, before this driver sees the
          // filter — every seamed read hands this emitter `$lt` the next day in
          // the calendar-string domain, which it converts to storage form like
          // any comparand (D-A1, D-E3), and the last supported day as
          // `{ $null: false }`. The copy this emitter kept (#3777, #20600) is
          // deleted: a caller that passes no seam compiles the comparison it
          // wrote, `<=` / BETWEEN against midnight.
          const op = rawOp;
          if (this.isOracle) assertOracleComparandNotEmptyString(op, localField, opValue, refusalSubtree(value, condition));
          const coerced = this.coerceFilterValue(table, localField, opValue);
          if (columnExpr && this.applyNormalizedComparison(builder, logicalOp, columnExpr, op, coerced)) continue;
          switch (op) {
            case '$eq':
              (builder as any)[method](field, coerced);
              break;
            case '$ne':
              // `<> NULL` matches nothing; a null comparand means "has any value".
              // UNCHANGED by #5298: `IS NOT NULL` is already total, and both
              // sides of the ruling agree a row with no value does NOT have
              // "any value". Only the value COMPARISON below becomes NULL-safe.
              //
              // [#6050] The test was `coerced == null` — LOOSE, so it also
              // caught `undefined`, while the two polarity tables that must
              // pin THIS emitter's spelling (`operatorIsNullTotal`,
              // `nullValueSatisfiesOperator` then; since #20822 the shared
              // lowering's) read `=== null`. That split was
              // defect B: `{ $not: { d: { $ne: undefined } } }` compiled a
              // guarded tautology and answered `[]` where remote answered
              // `['3','4']`. Now that `undefined` is refused upstream the two
              // spellings cover the same domain, and the strict one is written
              // for the reason #5347 gave when it tightened the `$null` arm:
              // a lenient test keeps compiling if the gate is ever moved, and
              // silently resumes answering for a value nobody ruled on. Note
              // `coerceFilterValue` is total (every arm returns its input on a
              // shape it cannot canonicalise), so it cannot manufacture an
              // `undefined` the gate never saw.
              if (coerced === null) (builder as any)[logicalOp === 'or' ? 'orWhereNotNull' : 'whereNotNull'](field);
              else this.applyNullSafeNegative(builder, method, field, (qb) => qb.orWhere(field, '<>', coerced));
              break;
            case '$gt':
              (builder as any)[method](field, '>', coerced);
              break;
            case '$gte':
              (builder as any)[method](field, '>=', coerced);
              break;
            case '$lt':
              (builder as any)[method](field, '<', coerced);
              break;
            case '$lte':
              (builder as any)[method](field, '<=', coerced);
              break;
            case '$in': {
              const mIn = logicalOp === 'or' ? 'orWhereIn' : 'whereIn';
              (builder as any)[mIn](field, coerced as any[]);
              break;
            }
            case '$nin': {
              // [#5298] NULL-safe: "not among this list" holds vacuously for a
              // value that is not there, which is what every JS backend answers.
              this.applyNullSafeNegative(builder, method, field, (qb) =>
                qb.orWhereNotIn(field, coerced as any[]),
              );
              break;
            }
            // [commit e04a0aff2] The MEMBERSHIP reading first: on a JSON column this
            // operator asks whether the comparand is an ELEMENT of the stored
            // array, not whether it is a substring of the serialization. Falls
            // through to the substring emitter for every scalar string column,
            // which is the other half of the sentence the spec now states.
            case '$contains':
              if (!this.applyJsonMembership(builder, method, table, localField, field, opValue, false)) {
                this.applyContainsLike(builder, method, field, opValue);
              }
              break;
            // [#5702] The case-INSENSITIVE twin of `$contains`, and the
            // replacement `RETIRED_FILTER_OPERATORS` prescribes for `$regex`.
            // Same `applyLike` — same escaped character class, same bound
            // `ESCAPE` — with the fold applied to BOTH sides, because folding
            // only the comparand compares a folded needle against a raw column
            // and matches just the rows that were already lower-case.
            case '$icontains':
              this.applyLike(builder, method, field, opValue, 'contains', false, true);
              break;
            case '$notContains':
              // [commit e04a0aff2] The exact complement of the arm above, on the same
              // population and the same construct. It moves WITH `$contains`
              // and cannot be deferred: this operator is declared "the negation
              // of $contains, on the same comparand contract", so leaving it on
              // the substring emitter would make the pair non-complementary on
              // every JSON column — `['redwood']` would answer neither
              // `$contains: 'red'` nor `$notContains: 'red'`.
              if (!this.applyJsonMembership(builder, method, table, localField, field, opValue, true)) {
                // [#5298] NULL-safe: `NOT LIKE` is UNKNOWN for a NULL column, and
                // "does not contain" is true of a value that is not there.
                this.applyNullSafeNegative(builder, method, field, (qb) =>
                  this.applyLike(qb, 'orWhere', field, opValue, 'contains', true),
                );
              }
              break;
            case '$startsWith':
              this.applyLike(builder, method, field, opValue, 'starts');
              break;
            case '$endsWith':
              this.applyLike(builder, method, field, opValue, 'ends');
              break;
            // [#7536] The pattern pair. NOT `applyLike`: that method escapes the
            // comparand and wraps it in the shape's wildcards, which is the
            // exact rewrite these two operators exist to avoid. The wildcards
            // are the CALLER's, the match is against the WHOLE value, and
            // `reduceFilterKey` has already refused a non-string pattern and a
            // dangling trailing escape — so `opValue` is a compilable pattern
            // by the time it reaches here.
            //
            // `opValue` rather than `coerced`: `coerceFilterValue` canonicalises
            // a comparand against the column's TYPE (dates, booleans, numbers),
            // and a pattern is not a value of that type — coercing it would
            // rewrite the pattern text.
            case '$like':
              this.applyLikePattern(builder, method, field, opValue as string, false);
              break;
            case '$ilike':
              this.applyLikePattern(builder, method, field, opValue as string, true);
              break;
            case '$between': {
              const arr = Array.isArray(coerced) ? coerced : [];
              if (arr.length !== 2) {
                // [#8197] `opValue`, never `coerced`: coercion can return a NEW
                // array, and a node the resolver cannot find under the query's
                // own `where` root resolves to `null` — withheld — for every
                // caller including an author who really did write it.
                throw betweenArityError(field, refusalSubtree(opValue, value));
              }
              (builder as any)[logicalOp === 'or' ? 'orWhereBetween' : 'whereBetween'](field, arr as [any, any]);
              break;
            }
            // `{ $null: true }` → IS NULL, `{ $null: false }` → IS NOT NULL.
            // Also the SQL rendering of the AST `is_null`/`is_not_null` operators
            // (spec `parseFilterAST` maps those to `$null`). Previously this fell
            // to the equality default and compiled `field = true`, silently
            // returning the wrong rows (issue #2704).
            //
            // [#5347] `opValue` is a boolean here — `reduceFilterKey` refused
            // anything else while validating the tree, which happens before this
            // emitter runs. The `=== false` test is therefore an exhaustive
            // two-way choice, not the "anything but false is IS NULL" rule it
            // used to be; that rule was this driver's half of a three-way split
            // across the backends. See {@link nonBooleanNullComparandError}.
            case '$null':
              (builder as any)[opValue === false
                ? (logicalOp === 'or' ? 'orWhereNotNull' : 'whereNotNull')
                : (logicalOp === 'or' ? 'orWhereNull' : 'whereNull')](field);
              break;
            // Mongo `$exists`: a present field is a non-null column in SQL.
            case '$exists':
              (builder as any)[opValue === false
                ? (logicalOp === 'or' ? 'orWhereNull' : 'whereNull')
                : (logicalOp === 'or' ? 'orWhereNotNull' : 'whereNotNull')](field);
              break;
            default: {
              // [#5702] A RETIRED spelling gets the prescription, not the
              // vocabulary list: the author who wrote `$regex` needs
              // `$icontains`, and a list of fifteen names does not say so.
              //
              // [#20020] `value` — this field's operator map — is the node both
              // refusals hand the provenance seam: an object, so markable, and
              // held by reference under the query's `where` root.
              const retired = retiredFilterOperatorError(op, field, Object.keys(value as object), value);
              if (retired) throw retired;
              throw unsupportedFilterOperatorError(op, field, value);
            }
          }
        }
      } else {
        const localField = this.mapSortField(key);
        const field = this.remoteColumn(table, key, localField);
        const method = logicalOp === 'or' ? 'orWhere' : 'where';
        // #7398 — the bare `{ field: value }` spelling again, reached when the
        // condition carries an operator SOMEWHERE (so `applyFilters` routed the
        // whole node here) but not on this key. Same compilation, same gate:
        // one condition must not have two verdicts depending on its siblings.
        // [#8197] A bare comparand is usually a primitive, so `condition` — this
        // node, an ARM of the merge when one happened — is what carries the mark.
        //
        // [#19885] The comparand gate first, in the order the top-level loop
        // runs its two: this branch is the third of the three positions
        // {@link SqlDriver.assertOperatorAppliesToColumn}'s docblock names, and
        // it carried the column gate without the comparand one. So an array in
        // the equality slot passed here unrefused whenever the leaf sat under
        // `$and` / `$or` / `$not` — or beside a sibling key that carries an
        // operator, which routes the whole node here too. SQLite then refused
        // the bind (a 500 `DATABASE_ERROR` for a filter the caller can fix) and
        // Postgres bound the array as its array-literal text (`{"a"}`) and
        // silently answered the wrong rows. Same gate, same `INVALID_FILTER` /
        // 400, as the same leaf gets at top level.
        assertCompilableComparand(field, '=', value, condition);
        this.assertOperatorAppliesToColumn(
          table, localField, field, '=', true, refusalSubtree(value, condition),
        );
        if (this.isOracle) assertOracleComparandNotEmptyString('=', localField, value, refusalSubtree(value, condition));
        const coerced = this.coerceFilterValue(table, localField, value);
        const columnExpr = this.filterColumnExpr(table, localField, field);
        if (columnExpr && this.applyNormalizedComparison(builder, logicalOp, columnExpr, '=', coerced)) continue;
        (builder as any)[method](field, coerced as any);
      }
    }
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
