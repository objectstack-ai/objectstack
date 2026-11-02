// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Filter helpers" section of `SqlDriver`: the bodies of
 * `tableNameForBuilder`, `toDateOnly`, `sqliteCanonicalDatetimeSql`,
 * `sqliteNonTemporalTextSql`, `sqliteCanonicalTimeSql`, `presentReadColumns`
 * moved out of `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
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
 * them on the driver at call time, so a subclass override or an instance spy
 * is still the one reached; fields and accessors go as GETTERS, read when the
 * body reads them, as they were on the class.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form
 * no evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { temporalStorageForm } from '@objectstack/core';
import type { SqlDriver, ReadPresentationKind } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface FilterHelpersHost {
  presentReadValue: SqlDriver['presentReadValue'];
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
