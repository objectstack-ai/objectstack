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
 *
 * ## The operand policies (#21042)
 *
 * The same two faces must also AGGREGATE the same operand, or they answer
 * different numbers for one query before any presenter runs: on PostgreSQL the
 * analytics native-SQL face added exact decimals where `driver-sql` adds
 * doubles (#20387), and answered `500` for a `sum` over a boolean that
 * `driver-sql` casts first (#11635). So the operand half moved here too, from
 * `driver-sql`, where it was module-private:
 *
 * - {@link AGGREGATE_ACCUMULATION} (moved with its docblock, in the driver's
 *   voice) — what each function accumulates in;
 * - {@link aggregandColumnClass} — the ONE column-class predicate both
 *   policies read, over the declared shape `{ type, multiple }`;
 * - {@link POSTGRES_BOOLEAN_AGGREGAND_CAST} — the functions a PostgreSQL
 *   boolean aggregand is cast for;
 * - {@link doubleAccumulationOperand} — the double operand, the dialect a
 *   parameter;
 * - {@link aggregandOperandSql} — the three composed, in the one order both
 *   faces emit: the cast inside, the double operand around it.
 *
 * `driver-sql` reads its own registries for a column's class (filled by the
 * predicate), and the native-SQL face asks the predicate with the declaration
 * the analytics host already relays (`declaredValueShape`). The stated cost:
 * this package now carries a second piece of dialect SQL text, beside
 * `json-membership-sql.ts`.
 */

import {
  isMultiValueField,
  numericColumnFor,
  NUMERIC_VALUE_TYPES,
  type AggregationFunction,
} from '@objectstack/spec/data';

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

/**
 * [#20387] What each declared aggregate function ACCUMULATES IN on PostgreSQL
 * and MySQL — the arithmetic half of the one-double policy
 * {@link AGGREGATE_ANSWER_KIND} states for the answer's type.
 *
 * - `'double'` — `avg`, over every declared numeric or boolean aggregand.
 * - `'double-over-fractional'` — `sum`, over a declared column whose values are
 *   fractions (`fractionalNumericFields`: the exact-decimal family and the
 *   driver's `float` alias). A `sum` over an integer-valued column (`rating`,
 *   the `integer` / `int` aliases, a boolean) stays the database's exact
 *   integer total, rounded once to the double by the presenter.
 * - `'as-stored'` — `count` / `count_distinct` (a count is an exact integer)
 *   and `min` / `max` (a value OF the column; no arithmetic happens).
 *
 * Why: the engine's rows path (`objectql`'s `in-memory-aggregation.ts`) and
 * SQLite add JS doubles, while PostgreSQL's `numeric` and MySQL's `DECIMAL`
 * add exact decimals. Measured on live PostgreSQL 16.13 and MySQL 8.0.46 over
 * a `number` column holding `0.1` and `0.2`: `sum` answered `0.3` natively and
 * `0.30000000000000004` on SQLite and every rows path, so
 * `having { s: { $eq: 0.3 } }` kept the group on those two native faces only.
 * `avg` over an INTEGER column diverged too, which is why `avg` is `'double'`
 * whatever the column holds: MySQL rounds a `DECIMAL` average to
 * `div_precision_increment` (4) places (`avg` of 1, 2, 2 answered `1.6667`),
 * and PostgreSQL's `numeric` average rounds to 16 places before the presenter
 * rounds again (`11 / 9` answered `1.2222222222222222`, JS
 * `1.2222222222222223`; 10 of 27,962 integer pairs measured).
 *
 * The operand is the column's TEXT, parsed as a double —
 * `cast(cast(x as text) as double precision)` on PostgreSQL,
 * `cast(cast(x as char) as double)` on MySQL — because that is the value the
 * SQL client hands `find()`, and so the value the rows path adds. For an
 * exact-decimal column it is the plain cast (both servers convert a decimal to
 * a double through its text); for a binary `real` / `FLOAT` column, which a
 * table created before the exact-decimal columns still carries, the plain cast
 * would widen the binary32 value (`0.1` → `0.10000000149011612`) where the
 * client reads `0.1`. MySQL's `CAST(… AS DOUBLE)` needs 8.0.17 or later.
 *
 * ⚠️ Residual, stated: on PostgreSQL and MySQL the double sums are added in
 * scan order, one after another, without compensation. SQLite (3.43+) adds with
 * compensated (Kahan-Babuska-Neumaier) summation, and since #20489 so does the
 * engine's rows path (`in-memory-aggregation.ts`, `compensatedSum`), so a group
 * of three or more fractions can still differ in the last place between the
 * PostgreSQL / MySQL native faces and those two (`0.1 + 0.2 + 0.3`: PostgreSQL /
 * MySQL `0.6000000000000001`, SQLite and the rows path `0.6`). Two addends
 * cannot differ, which is why the pin is `0.1 + 0.2`.
 *
 * A `Record` over `AggregationFunction` for the same reason as
 * {@link AGGREGATE_ANSWER_KIND}: a function added to the vocabulary without an
 * answer here fails `tsc`.
 */
export const AGGREGATE_ACCUMULATION: Readonly<
  Record<AggregationFunction, 'double' | 'double-over-fractional' | 'as-stored'>
> = {
  count: 'as-stored',
  count_distinct: 'as-stored',
  sum: 'double-over-fractional',
  avg: 'double',
  min: 'as-stored',
  max: 'as-stored',
};

/**
 * [#21042] The class of an aggregated column, as the operand policies read it:
 *
 * - `'fractional'` — its values are fractions: the exact-decimal members of
 *   `NUMERIC_COLUMN_REPRESENTATION` (`numericColumnFor(type).kind ===
 *   'exact'`: `number`, `currency`, `percent`, `slider`, `progress`,
 *   `summary`) and `driver-sql`'s `float` alias. `sum` accumulates in double
 *   over these ({@link AGGREGATE_ACCUMULATION}).
 * - `'integral'` — its values are integers: `rating`, and `driver-sql`'s
 *   `integer` / `int` aliases (how an introspected `bigint` reaches it). `sum`
 *   keeps the exact total; `avg` accumulates in double.
 * - `'boolean'` — `boolean` / `toggle`. `avg` accumulates in double; on
 *   PostgreSQL every function but the counts casts it to `int` first
 *   ({@link POSTGRES_BOOLEAN_AGGREGAND_CAST}).
 *
 * Every other column — text, a date, a multi-valued (JSON) list, a column with
 * no declaration — is in no class, and every policy leaves it as stored.
 */
export type AggregandColumnClass = 'fractional' | 'integral' | 'boolean';

/**
 * [#20387, #11635, #21042] The ONE column-class predicate the aggregate operand
 * policies read, over a column's declared shape `{ type, multiple }`.
 *
 * It replaces `driver-sql`'s module-private `isFractionalNumericType` and states
 * the classes that driver's registries record for the same declaration: its
 * fractional registry is filled by this predicate, and its numeric and boolean
 * registries hold exactly the other two classes (`driver-sql`'s move proof
 * pins the statements each class emits). SCALAR only: a column whose stored
 * value is a list (`isMultiValueField`, the same question `driver-sql`'s
 * storage asks) is in no class, and a `multiple` flag on a type that cannot be
 * multi-valued changes nothing, as it changes nothing in storage.
 *
 * The three `driver-sql` aliases ride here because the class is the driver's
 * as much as the declaration's: they are not `FieldType`s, and only an
 * introspected (federated) column carries one.
 */
export function aggregandColumnClass(
  shape: { readonly type?: unknown; readonly multiple?: unknown } | null | undefined,
): AggregandColumnClass | undefined {
  const type = shape?.type;
  if (typeof type !== 'string') return undefined;
  if (isMultiValueField({ type, multiple: shape?.multiple === true })) return undefined;
  if (type === 'boolean' || type === 'toggle') return 'boolean';
  if (type === 'float' || numericColumnFor(type)?.kind === 'exact') return 'fractional';
  if (type === 'integer' || type === 'int' || NUMERIC_VALUE_TYPES.has(type)) return 'integral';
  return undefined;
}

/**
 * [#11635] The functions whose BOOLEAN aggregand is cast to `int` on
 * PostgreSQL — the one dialect that stores `Field.boolean` as a real `boolean`
 * column and defines no `sum` / `avg` / `min` / `max` over it (SQLSTATE
 * `42883`, measured on PG 16.13; SQLite stores 0/1 INTEGER and MySQL
 * `tinyint(1)`, so both compute natively). The answers are ruled ([#11152]):
 * all four answer numbers, `sum` / `avg` arithmetic over 1/0 and `min` / `max`
 * the `0` / `1` the cast computes. `count` / `count_distinct` are deliberately
 * NOT cast — `count` is defined over boolean everywhere, and their answers
 * were correct before the cast existed and must not move.
 *
 * A `Record` over `AggregationFunction`, as {@link AGGREGATE_ACCUMULATION}: a
 * function added to the vocabulary without an answer here fails `tsc`.
 */
export const POSTGRES_BOOLEAN_AGGREGAND_CAST: Readonly<Record<AggregationFunction, boolean>> = {
  count: false,
  count_distinct: false,
  sum: true,
  avg: true,
  min: true,
  max: true,
};

/**
 * The SQL dialects the operand policies are stated for: the three a SQL face
 * of the platform emits for, and `'unknown'` — the same four names
 * `driver-sql`'s `SqlDialectName` and the analytics compilers' dialect carry.
 * Neither policy applies on SQLite (it already adds doubles and stores a
 * boolean as 0 / 1) or on a dialect nobody named.
 */
export type AggregandSqlDialect = 'sqlite' | 'postgres' | 'mysql' | 'unknown';

/**
 * [#20387] The operand of a double-accumulated `sum` / `avg`: the column's
 * text, parsed as a double — the value the SQL client hands `find()`, and so
 * the value the rows path adds. See {@link AGGREGATE_ACCUMULATION} for why the
 * text and not a plain cast.
 */
export function doubleAccumulationOperand(operand: string, dialect: 'postgres' | 'mysql'): string {
  return dialect === 'postgres'
    ? `cast(cast(${operand} as text) as double precision)`
    : `cast(cast(${operand} as char) as double)`;
}

/** [#20387] Whether `func` accumulates in double over a column of `columnClass` on `dialect`. */
function accumulatesInDouble(
  func: AggregationFunction,
  columnClass: AggregandColumnClass | undefined,
  dialect: AggregandSqlDialect,
): dialect is 'postgres' | 'mysql' {
  if (dialect !== 'postgres' && dialect !== 'mysql') return false;
  switch (AGGREGATE_ACCUMULATION[func]) {
    case 'double':
      return columnClass !== undefined;
    case 'double-over-fractional':
      return columnClass === 'fractional';
    case 'as-stored':
      return false;
  }
}

/**
 * [#20387, #11635, #21042] The operand an aggregate wraps, per the policies
 * above: `operand` — the column as the caller already spells it (a knex
 * identifier binding, a quoted column) — cast to `int` when it is a PostgreSQL
 * boolean aggregand of a function {@link POSTGRES_BOOLEAN_AGGREGAND_CAST}
 * names, and then wrapped in {@link doubleAccumulationOperand} when
 * {@link AGGREGATE_ACCUMULATION} says the function accumulates in double over
 * its class on PostgreSQL or MySQL. Otherwise `operand`, unchanged.
 *
 * One composition, so the faces cannot order the two differently: a PostgreSQL
 * boolean `avg` is `cast(cast(cast(x as int) as text) as double precision)` on
 * every face. A column in no class (`undefined`) is aggregated as stored — the
 * answer a face that cannot read the column's declaration keeps.
 */
export function aggregandOperandSql(
  func: AggregationFunction,
  columnClass: AggregandColumnClass | undefined,
  dialect: AggregandSqlDialect,
  operand: string,
): string {
  const cast = dialect === 'postgres' && columnClass === 'boolean' && POSTGRES_BOOLEAN_AGGREGAND_CAST[func]
    ? `cast(${operand} as int)`
    : operand;
  return accumulatesInDouble(func, columnClass, dialect) ? doubleAccumulationOperand(cast, dialect) : cast;
}
