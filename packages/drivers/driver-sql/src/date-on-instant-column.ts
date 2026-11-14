// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32851] A `Field.date` whose column is still an INSTANT column.
 *
 * `createColumn` gives a `date` field a `date` column, and the additive sync
 * never revisits an existing column's type. So a field retyped `datetime` →
 * `date` and published keeps the `timestamptz` column its `datetime`
 * declaration built, and the driver's `date` path, written for a `date`
 * column, met a column that holds instants:
 *
 *   - the WRITE bound the bare day `'2026-11-12'`, which Postgres reads into
 *     `timestamptz` as midnight in the SESSION's zone, so on a server at
 *     `Asia/Shanghai` it stored `2026-11-11T16:00:00Z`;
 *   - the READ folds the `Date` node-pg hands back by its UTC components
 *     (ADR-0053; `temporalStorageForm`), so that row read `2026-11-11`;
 *   - a FILTER bound the same bare day, cast in the session zone again, so
 *     `due = '2026-11-12'` matched the row that READ `2026-11-11` and missed a
 *     row written as a `datetime` that read `2026-11-12`;
 *   - the DATE BUCKET cast the column with `::date`, also in the session
 *     zone, and put both of those rows on `2026-11-12`.
 *
 * Four doors, three answers, no error. Measured on live Postgres 16 with the
 * server at `Asia/Shanghai` and the process at `America/New_York`.
 *
 * The fix pins every door to ONE zone, UTC, the zone the read already uses,
 * so nothing a `datetime` field reads moves and no stored value is rewritten:
 *
 *   - the write binds the day as the instant of its UTC midnight
 *     ({@link utcMidnightOfDay});
 *   - a filter and a date bucket read the column as its UTC calendar day
 *     ({@link utcCalendarDaySql}), so they compare and group the day the read
 *     presents, for every stored value, including one written while the field
 *     was a `datetime`.
 *
 * The column is NOT narrowed to `date` here: that rewrites every stored value
 * (it drops the time of day a `datetime` wrote), which is a data change, not a
 * read rule.
 *
 * [#33002] SQLite and MySQL keep the instant column too (SQLite's `datetime`,
 * MySQL's `DATETIME`), and there the zone was never the problem: MySQL's
 * session is pinned to UTC (`withUtcSession`) and `DATETIME` is zone-naive,
 * SQLite stores the canonical UTC text. But a row written while the field was
 * a `datetime` still holds its time of day, so it READ as its day while an
 * equality filter compared the bare day against the whole instant and missed
 * it. So a FILTER on such a column reads it as its calendar day on every
 * dialect ({@link isInstantColumnType} records it, `filterColumnExpr` reads
 * it); the write keeps the bare day there (it already is UTC midnight), and
 * the day bucket already answered the day (`strftime` / `date_format`).
 */

/**
 * The registry: per table, the `Field.date` fields whose physical column is an
 * instant type ({@link isInstantColumnType}). Recorded by the schema sync from the column
 * catalog it already reads, and EMPTY until a sync has looked — a driver that
 * never synced the table (deferred DDL, a guest datasource) keeps the plain
 * `date` path it had before.
 */
export type DateFieldsOnInstantColumn = Record<string, Set<string>>;

/**
 * Whether `field` of `table` is a declared `Field.date` that the sync found on
 * an instant column. Both registries are asked: a field retyped away from
 * `date` since the last sync leaves the date registry first.
 */
export function isDateOnInstantColumn(
  host: { readonly dateFields: Record<string, Set<string>>; readonly dateFieldsOnInstantColumn: DateFieldsOnInstantColumn },
  table: string | null | undefined,
  field: string,
): boolean {
  if (!table) return false;
  return host.dateFieldsOnInstantColumn[table]?.has(field) === true && host.dateFields[table]?.has(field) === true;
}

/**
 * Whether a catalog type (as knex `columnInfo()` reports it) is the instant
 * column this driver builds for a `Field.datetime` on `dialect`, the one a
 * `datetime` → `date` publish leaves under a `date` field:
 *
 * - Postgres: `timestamp with time zone` only, whose bare-day cast reads the
 *   session zone (`timestamp without time zone` is never built here);
 * - MySQL / MariaDB: `datetime` (and `timestamp`, which an older table may
 *   carry);
 * - SQLite: `datetime`, the declared type of the TEXT column holding the
 *   canonical UTC instant (a `date` field's own column declares `date`).
 *
 * Any other dialect records nothing and keeps its `date` path.
 */
export function isInstantColumnType(dialect: string, type: unknown): boolean {
  const t = String(type ?? '').trim().toLowerCase();
  if (dialect === 'postgres') return t === 'timestamp with time zone';
  if (dialect === 'mysql') return t === 'datetime' || t === 'timestamp';
  if (dialect === 'sqlite') return t === 'datetime';
  return false;
}

/** The fixed-width calendar day `temporalStorageForm(…, 'date')` answers. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The write binding of a calendar day into an instant column: the instant of
 * its UTC midnight, zone explicit, so the server's zone takes no part. Any
 * other shape (a value the day fold could not read) is handed back unchanged
 * for the server to refuse as it did before.
 */
export function utcMidnightOfDay(day: unknown): unknown {
  return typeof day === 'string' && CALENDAR_DAY.test(day) ? `${day}T00:00:00.000Z` : day;
}

/**
 * The SQL that reads a Postgres instant column as its UTC calendar day — the
 * day the read door presents. `columnSql` is an identifier placeholder (`??`)
 * or an already-quoted column reference.
 */
export function utcCalendarDaySql(columnSql: string): string {
  return `((${columnSql}) AT TIME ZONE 'UTC')::date`;
}

/**
 * [#33002] The SQL that reads a MySQL `DATETIME` instant column as its calendar
 * day. The column is zone-naive and the session is UTC, so `date()` answers the
 * day the read presents.
 */
export function mysqlCalendarDaySql(columnSql: string): string {
  return `date(${columnSql})`;
}

/**
 * [#33002] The SQL that reads a SQLite instant column as its calendar day:
 * the first ten characters of its canonical UTC text. `canonicalSql` is the
 * column already put in canonical form (`sqliteCanonicalDatetimeSql`), so a
 * legacy epoch-millisecond value answers its UTC day too, and a bare day
 * (`YYYY-MM-DD`, what the write stores after the publish) answers itself.
 */
export function sqliteCalendarDaySql(canonicalSql: string): string {
  return `substr(${canonicalSql}, 1, 10)`;
}
