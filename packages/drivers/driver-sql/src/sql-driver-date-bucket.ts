// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25521 cut 20] Date bucketing of `SqlDriver`: `buildDateBucketExpr`, the
 * per-dialect SQL fragment a date dimension groups by at `day`, `week`,
 * `month`, `quarter` or `year` (PostgreSQL `to_char`, MySQL `date_format`,
 * SQLite `strftime`, with the #21485 calendar-day arm for a `Field.date` and the
 * #21595 Thursday-rule ISO week on SQLite). It moved out of `sql-driver.ts`
 * whole.
 *
 * A MOVE, not a redesign. The function below is the body of the `SqlDriver`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited: the same SQL, the same bindings, the same `null` for a granularity
 * the dialect does not model.
 *
 * What did NOT move, and why:
 *
 *  - The method's docblock stays on the class: it is the contract, and the
 *    published `dist/*.d.ts` carries it with the method.
 *  - Its callers stay: `aggregate` (the GROUP BY) and `dateBucketSql` (the
 *    printed form `service-analytics` echoes).
 *  - `dateGranularityCapabilities`, `temporalFieldKind` and `sqliteTemporalArg`
 *    are read by members that stay too, and subclasses may override them; the
 *    body reaches them through the host.
 *
 * ## How the moved body reaches the class
 *
 * The shape the other seam modules apply, after #23050. The class keeps the
 * method, because the published `dist/*.d.ts` lists its name and position, and
 * because an instance spy or a subclass method of the same name must still be
 * the one `aggregate` reaches. The method is now one literal of exactly the
 * {@link DateBucketHost} members the body reads, plus a `.call`. Methods go as
 * closures that call them on the driver at call time, so a subclass override
 * or an instance spy is still the one the body reaches; `isPostgres`,
 * `isMysql`, `isSqlite` and the `dateGranularityCapabilities` getter go as
 * GETTERS, so each is read when the body reads it, as it was on the class.
 *
 * The module imports `sql-driver.ts` for a type only, so the two modules form
 * no evaluation cycle. `index.ts` re-exports nothing from this module, so the
 * published surface does not move.
 */

import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the function below reads — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too, and naming a member the class does not have is a compile error. See
 * the module header for which members are getters.
 */
export interface DateBucketHost {
  readonly dateGranularityCapabilities: SqlDriver['dateGranularityCapabilities'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly isPostgres: SqlDriver['isPostgres'];
  readonly isSqlite: SqlDriver['isSqlite'];
  sqliteTemporalArg: SqlDriver['sqliteTemporalArg'];
  temporalFieldKind: SqlDriver['temporalFieldKind'];
}

/** The body of `SqlDriver#buildDateBucketExpr`; the method's docblock there is its contract. */
export function buildDateBucketExpr(this: Pick<DateBucketHost, 'dateGranularityCapabilities' | 'isMysql' | 'isPostgres' | 'isSqlite' | 'sqliteTemporalArg' | 'temporalFieldKind'>, field: string, granularity: 'day' | 'week' | 'month' | 'quarter' | 'year', table?: string | null): { sql: string; bindings: any[] } | null {
  if (!this.dateGranularityCapabilities[granularity]) return null;

  const calendarDay = this.temporalFieldKind(table, field) === 'date';

  if (this.isPostgres) {
    const arg = calendarDay ? `(??)::date::timestamp` : `(??)::timestamptz AT TIME ZONE 'UTC'`;
    switch (granularity) {
      case 'year':    return { sql: `to_char(${arg}, 'YYYY')`, bindings: [field] };
      case 'month':   return { sql: `to_char(${arg}, 'YYYY-MM')`, bindings: [field] };
      case 'day':     return { sql: `to_char(${arg}, 'YYYY-MM-DD')`, bindings: [field] };
      case 'quarter': return { sql: `to_char(${arg}, 'YYYY"-Q"Q')`, bindings: [field] };
      case 'week':    return { sql: `to_char(${arg}, 'IYYY"-W"IW')`, bindings: [field] };
    }
  }

  if (this.isMysql) {
    const arg = calendarDay ? `??` : `convert_tz(??, @@session.time_zone, '+00:00')`;
    switch (granularity) {
      case 'year':    return { sql: `date_format(${arg}, '%Y')`, bindings: [field] };
      case 'month':   return { sql: `date_format(${arg}, '%Y-%m')`, bindings: [field] };
      case 'day':     return { sql: `date_format(${arg}, '%Y-%m-%d')`, bindings: [field] };
      case 'quarter': return { sql: `concat(date_format(${arg}, '%Y'), '-Q', quarter(${arg}))`, bindings: [field, field] };
      case 'week':    return { sql: `date_format(${arg}, '%x-W%v')`, bindings: [field] };
    }
  }

  if (this.isSqlite) {
    // `arg` is a bare `??` for a TEXT-stored column and an epoch→julian-day
    // normalization for a `Field.datetime` one (#3773).
    const { sql: arg, bindings: argBindings } = this.sqliteTemporalArg(field, table);
    const fmt = (f: string) => ({ sql: `strftime('${f}', ${arg})`, bindings: [...argBindings] });
    switch (granularity) {
      case 'year':    return fmt('%Y');
      case 'month':   return fmt('%Y-%m');
      case 'day':     return fmt('%Y-%m-%d');
      case 'quarter': return { sql: `(strftime('%Y', ${arg}) || '-Q' || ((cast(strftime('%m', ${arg}) as integer) - 1) / 3 + 1))`, bindings: [...argBindings, ...argBindings] };
      case 'week': {
        // [#21595] The ISO 8601 week, `YYYY-Www`: the label the PostgreSQL
        // arm's `IYYY"-W"IW` and the MySQL arm's `%x-W%v` answer. A week
        // belongs to the year of its Thursday. `'-3 days', 'weekday 4'` moves
        // any day to the Thursday of its Monday-start week (a Monday moves
        // +3, a Sunday -3), so that Thursday's `%Y` is the week-numbering
        // year and `(%j - 1) / 7 + 1` of it is the week number. Both
        // modifiers predate every SQLite this platform ships, unlike `%V`
        // (see `dateGranularityCapabilities`). No zone is read, so a
        // `Field.date` stays its calendar day.
        const thursday = (f: string) => `strftime('${f}', ${arg}, '-3 days', 'weekday 4')`;
        return {
          sql: `(${thursday('%Y')} || '-W' || printf('%02d', (cast(${thursday('%j')} as integer) - 1) / 7 + 1))`,
          bindings: [...argBindings, ...argBindings],
        };
      }
    }
  }

  return null;
}
