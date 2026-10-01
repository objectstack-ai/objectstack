// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20889] What an aggregate ANSWERS, and the `'number'` presenter that gives a
 * count or a total its type — defined once, for every face that hands a SQL
 * client's aggregate row to a caller.
 *
 * ## Why it lives here
 *
 * Two faces run an aggregate statement on a SQL client and must present its
 * answer the same way:
 *
 * - `@objectstack/driver-sql`'s native `aggregate()` (#20335), where this rule
 *   was written: `aggregate()` reads {@link AGGREGATE_ANSWER_KIND} to choose
 *   the result columns that take the `'number'` presentation, and
 *   `presentReadValue`'s `'number'` arm is {@link presentAsNumber};
 * - `@objectstack/service-analytics`' native-SQL face
 *   (`NativeSQLStrategy.execute`), which runs its own statement through the
 *   host's raw-SQL bridge — `engine.execute`, or an embedder's own
 *   `executeRawSql` — and so never passes through the driver's `aggregate()`.
 *   On PostgreSQL it answered `count: "2"` under a `fields[]` that declared
 *   `number`.
 *
 * `service-analytics` holds `driver-sql` as a development dependency only — it
 * is multi-driver, and its native path also runs over an embedder's raw SQL —
 * and this is the package both already stand on, the reason `compensatedSum`
 * lives here too. A second transcription is how a face comes to answer its own
 * type again.
 *
 * The table and its docblock below moved here from `driver-sql` unchanged, so
 * they speak of `SqlDriver.aggregate` and `formatOutput` in that driver's
 * voice.
 */

import type { AggregationFunction } from '@objectstack/spec/data';

/**
 * [#20335] What each declared aggregate function ANSWERS — a derived `number`,
 * or a value OF the aggregated column — and therefore which read presentation
 * {@link SqlDriver.aggregate} gives its result column.
 *
 * - `'number'` — `count`, `count_distinct`, `sum`, `avg`. A count or a total is
 *   a number whatever the column held, and it is presented as one (`'number'`,
 *   the presenter `formatOutput` applies to a numeric field on a `find()` row).
 * - `'column'` — `min`, `max`. The answer is one of the column's own values, so
 *   it takes that column's presentation ({@link SqlDriver.readPresentationKind}),
 *   exactly as before this table existed.
 *
 * Why the `'number'` half needs presenting at all: the SQL client hands a
 * result back as the wire type of the SQL expression, not as the platform's
 * value type. Measured on live PostgreSQL 16.13 and MySQL 8.0.46 through this
 * driver's own connections: node-postgres parses `bigint` (OID 20 — `count`,
 * and `sum` over an integer column) and `numeric` (OID 1700 — `sum` / `avg`
 * over the exact-decimal numeric family, `avg` over an integer column) to
 * STRINGS (`"2"`, `"500.000000000000000000000000000000"`), and mysql2 does the
 * same for `DECIMAL` (`SUM` / `AVG`; its `COUNT` arrives as a number). The
 * engine's rows path (`objectql`'s `in-memory-aggregation.ts`) and SQLite answer
 * numbers for the same query, so `having { n: { $in: [2] } }` kept c1, c2 on
 * those and no group on PostgreSQL's native path.
 *
 * Keyed on the function the query ASKED for, never on whether a value looks
 * numeric, and deliberately not gated by dialect: the presenter only rewrites a
 * STRING, so a client that already answers a number (better-sqlite3, mysql2's
 * `COUNT`) passes through untouched — measured byte-identical on SQLite — and
 * no list of "string-answering dialects" exists to drift.
 *
 * ## The precision policy — one JS number, the loss declared
 *
 * The answer is `Number(text)`: an IEEE-754 double, on every dialect. A `sum` /
 * `avg` over the exact-decimal column (`numeric(65,30)` / `DECIMAL(65,30)`)
 * whose value needs more than a double's ~15-17 significant digits, or an
 * integer at or above 2^53, is ROUNDED to the nearest double — declared, not
 * silent: it is the same bound `formatOutput` already puts on a `find()` read of
 * that column (#16318, `valueSchemaFor`'s `z.number().finite()`, ADR-0104 D1),
 * and the bound the rows path has always had (`toNumber` sums JS doubles). A
 * value-dependent type — a number when it fits, a string when it does not — was
 * rejected: it would reopen this defect for exactly the large totals, where a
 * `having` `$in` or a chart silently stops matching. Only a string `Number()`
 * reads as NaN (PostgreSQL's `numeric` `'NaN'`) is left as written, the
 * presenter's existing rule.
 *
 * A `Record` over `AggregationFunction` on purpose: a function that joins the
 * declared vocabulary without an answer here fails `tsc` rather than reaching a
 * caller unpresented.
 */
export const AGGREGATE_ANSWER_KIND: Readonly<Record<AggregationFunction, 'number' | 'column'>> = {
  count: 'number',
  count_distinct: 'number',
  sum: 'number',
  avg: 'number',
  min: 'column',
  max: 'column',
};

/**
 * [#20335, #20889] The `'number'` presentation: a STRING `Number()` reads as a
 * number becomes that number; every other value — a number, `null`, a boolean,
 * empty or blank text, text `Number()` reads as NaN (PostgreSQL's `numeric`
 * `'NaN'`) — is returned as given.
 *
 * It is the body of `driver-sql`'s `presentReadValue` `'number'` arm, moved
 * here unchanged: the presenter `formatOutput` applies to a declared numeric
 * column on a `find()` row (#16318), and the one {@link AGGREGATE_ANSWER_KIND}
 * names for a count or a total. The answer is one JS double — the precision
 * policy that table's docblock states.
 *
 * ⛔ Ask it by a column's DECLARED meaning — the aggregate function the query
 * asked for, or a column declared numeric — never because a value looks
 * numeric: a text column holding `'007'` is text.
 */
export function presentAsNumber(value: unknown): unknown {
  // Only strings are repaired, exactly as in `formatOutput`: a fresh
  // REAL/INTEGER column already yields a number, and genuinely
  // non-numeric legacy junk is left intact rather than turned into NaN.
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return value;
}
