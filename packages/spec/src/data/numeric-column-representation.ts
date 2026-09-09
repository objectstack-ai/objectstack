// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The NUMERIC column family's PHYSICAL REPRESENTATION — one explicit,
 * per-field-type table that every producer of DDL reads (#16318).
 *
 * Ruled C ∩ ④ (director seat, decision batch #86, 2026-09-08). Quoted, not
 * translated:
 *
 * > One explicit per-field-type physical-representation table lives in
 * > `packages/spec` (the protocol is the baseline) and both producers —
 * > `SqlDriver.createColumn` and `os generate migration` (sql + typescript
 * > formats) — read it … **New tables only**: no migration of existing
 * > columns (「不考虑现有数据」); SQLite affinity consequences stated per type.
 *
 * ## The divergence this closes — measured, not argued
 *
 * One object, seven plain numeric declarations, three producers, driven into
 * live PostgreSQL 16.13 and read back out of `information_schema.columns`
 * with `numeric_precision` / `numeric_scale` — the half a bare `data_type`
 * read hides:
 *
 * ```
 *              driver    sql gen         ts gen
 * number       real      numeric(18,2)   numeric(8,2)
 * currency     real      numeric(18,2)   numeric(8,2)
 * percent      real      numeric(5,2)    numeric(8,2)
 * slider       real      numeric(18,2)   numeric(8,2)
 * summary      real      numeric(18,2)   numeric(8,2)
 * progress     real      numeric(5,2)    numeric(8,2)
 * rating       real      integer         integer
 * ```
 *
 * 7 of 7 diverge, and six of them THREE ways rather than the two the report
 * named: `table.decimal(name)` with no arguments is knex's `decimal(8, 2)`,
 * so the two halves of one command never agreed with each other either. A
 * control family already unified (#16091: `text` / `email` / `boolean` /
 * `date`) came back 0-of-4 divergent in the same run, so AGREE is a reading
 * the instrument can produce.
 *
 * ## Why a NARROW scale could not stay, and what the loss actually is
 *
 * The report's reason was an INFERENCE off the DDL literal — that a
 * `DECIMAL(5,2)` column truncates a legitimate 33.333 to 33.33. Executed on
 * PostgreSQL 16.13, the direction is wrong and the substance holds: the
 * column ROUNDS half-up (33.336 arrives as 33.34), it does not truncate. The
 * loss is silent either way.
 *
 * Nothing upstream prevents it. Measured at the write seam: a `percent` /
 * `currency` / `number` field that declares no `scale` ACCEPTS 0.33333 and
 * 1234567.89 unchanged (4 of 4), while the same seam REFUSES both the moment
 * the field declares `scale: 2` (2 of 2 controls fired). So there is no
 * upstream rounding and no upstream validation to fall back on — for a field
 * with no declared `scale` the COLUMN is the only thing deciding, and a
 * narrow one silently alters data. `record-validator.ts` states the platform's
 * position on exactly that (#7501, maintainer ruling 2026-08-11): an
 * over-scale value "is refused the way an out-of-range one is; silent
 * rounding is silently altering data".
 *
 * ⚠️ `summary` has no seam at all — it is platform-computed, and
 * `validateRecord`'s type door excludes it — so for that member the column is
 * the ONLY guard.
 *
 * ## Where the two numbers come from — both are dialect maxima, not taste
 *
 * Every candidate column was driven against a nine-value corpus on live
 * PostgreSQL 16.13, written and read back through the driver's own pg type
 * parsing, with `12.5` as the firing control (a dyadic rational every
 * candidate holds exactly — it came back EXACT from all five, 0 of 5 lost):
 *
 * ```
 *   real            3/9 altered   <- the driver today
 *   numeric(8,2)    9/9 altered   <- the typescript format today
 *   numeric(18,2)   7/9 altered   <- the sql format today
 *   numeric(38,17)  2/9 altered
 *   numeric(65,30)  0/9 altered   <- this table
 * ```
 *
 * `real` is IEEE-754 binary32 and its 3 are the ones that matter most:
 * `1234567.89` reads back `1234567.9` and `Number.MAX_SAFE_INTEGER` reads
 * back `9007199000000000`. That is the money-fidelity defect the report
 * named, in a reading rather than an argument.
 *
 * {@link NUMERIC_COLUMN_SCALE} is 30 and {@link NUMERIC_COLUMN_PRECISION} is
 * 65 because those are MySQL's documented `DECIMAL` maxima — the binding
 * constraint among the dialects this platform speaks, PostgreSQL's ceiling
 * being 1000 digits and SQLite having none. Taking the maximum is what makes
 * the residual bound as far out as any portable exact-decimal column can put
 * it; ⛔ neither number is chosen for how it reads.
 *
 * ⚠️ An unconstrained `numeric` would be the honest shape on PostgreSQL and it
 * is NOT portable: measured through knex's own compilers, `decimal(name,
 * null)` compiles to `decimal` on `pg`, to `float` on `better-sqlite3`, and
 * THROWS on `mysql2` ("Specifying no precision on decimal columns is not
 * supported"). A stated pair is the only spelling all three accept, which is
 * what the ruling asked for.
 *
 * ## The residual bound, stated rather than assumed
 *
 * An exact-decimal column is bounded where a float is not, so this table is
 * not lossless in every direction, and the bound has two ends. Downward, the
 * column keeps 30 fractional digits, so a magnitude whose significant digits
 * run past the 30th decimal place loses the tail silently:
 * `1.2345678901234567e-15` stores as `0.000000000000001234567890123457`.
 * Precision loss therefore BEGINS around |x| < 1e-13 — where a double's ~17
 * significant digits first reach past the 30th decimal place — and is TOTAL
 * below 1e-30, where nothing is left and the value rounds to zero. Upward,
 * magnitudes at or above 1e35 are REFUSED (the 35 integer digits that
 * 65 - 30 leaves), where today's `real` keeps about seven significant digits
 * out to ~1e38. Two things make that the right trade: a refusal is loud and a
 * silent rounding is not, and the sql format's `numeric(18,2)` already
 * refuses everything at or above 1e16 today. It is a bound, and it is stated
 * here so no reader has to rediscover it.
 *
 * ## SQLite, per type — the constraint the report raised, answered
 *
 * `SqlDriver.createColumn`'s float arm records why `rating`/`slider`/
 * `progress` are in it: without an explicit case they fell to `table.string`,
 * the column took TEXT affinity, and SQLite stored `'4'` rather than `4`.
 * Measured on knex 3.3.0 / better-sqlite3, compiled DDL and live storage
 * class:
 *
 * ```
 *   table.float(c)           -> float      real:4  real:4.5  real:33.333
 *   table.decimal(c, 65, 30) -> float      real:4  real:4.5  real:33.333
 *   table.integer(c)         -> integer    integer:4  real:4.5  real:33.333
 *   table.string(c)          -> varchar(255)  text:4.0   <- the fossil's leak
 * ```
 *
 * Two per-type consequences follow, and neither is assumed:
 *
 *   - The six exact-decimal members emit BYTE-IDENTICAL SQLite DDL to the
 *     float arm they leave — `ColumnCompiler_SQLite3.prototype.decimal` is the
 *     literal `'float'`, the same string `floating` resolves to — so they keep
 *     REAL affinity and the fossil's leak stays defeated. SQLite applies no
 *     precision and no scale, so the exactness this table buys is a
 *     PostgreSQL/MySQL property; SQLite behaves exactly as it does today.
 *   - `rating` moves to INTEGER affinity. `4` is then stored as the integer
 *     `4` rather than the real `4.0`, and SQLite still accepts `4.5` as a REAL
 *     — it refuses no fractional value — so nothing this dialect accepts today
 *     stops being accepted. The refusal `rating` gains is a
 *     PostgreSQL/MySQL-only effect.
 *
 * A `table.string` control in the same run still compiled to `varchar(255)`
 * and still stored `text:4.0`, so "identical" above is a discriminating
 * reading and not a constant.
 *
 * ## `rating` — integer, and the half-star need was looked for
 *
 * The ruling made `rating` integer "unless the executor measures a half-star
 * need". There is no capability to measure: `Field.rating` takes a star COUNT
 * and the spec declares no half-star key for it. A field that genuinely wants
 * fractional stars is a `slider`, which is in the exact-decimal set above.
 *
 * ## Scope — NEW COLUMNS ONLY
 *
 * ⛔ This table decides what a NEW column is created as, and nothing else. It
 * retypes no existing column (schema sync is additive and never alters a
 * column's type in place), it plans no migration, and no drift finding reads
 * it. A deployment created before this table keeps its `real` columns, keeps
 * their values, and keeps reading them back as JS numbers through
 * `NUMERIC_SCALAR_TYPES`' read coercion — which is also what makes the new
 * columns read back as numbers, since node-postgres parses `numeric` to a
 * STRING and `real` to a number.
 */

import { NUMERIC_VALUE_TYPES } from './field-value.zod';

/**
 * Total digits for every exact-decimal column this table produces — MySQL's
 * documented `DECIMAL` maximum, and therefore the portable one. See the
 * provenance block above; ⛔ do not "tidy" it to a rounder number.
 */
export const NUMERIC_COLUMN_PRECISION = 65;

/**
 * Decimal places for every exact-decimal column this table produces — MySQL's
 * documented maximum `DECIMAL` scale, and the only scale measured to lose
 * nothing on the nine-value corpus above.
 */
export const NUMERIC_COLUMN_SCALE = 30;

/**
 * What a numeric field's column IS, kept as NAMED answers rather than a bare
 * pair — the same reason `generate.ts`'s `VarcharAnswer` is three answers and
 * not a number. `integer` is not "an exact decimal with scale 0": it is a
 * different column type with a different refusal, and on SQLite a different
 * affinity.
 */
export type NumericColumnRepresentation =
  | { readonly kind: 'integer' }
  | { readonly kind: 'exact'; readonly precision: number; readonly scale: number };

const EXACT: NumericColumnRepresentation = {
  kind: 'exact',
  precision: NUMERIC_COLUMN_PRECISION,
  scale: NUMERIC_COLUMN_SCALE,
};

/**
 * The per-type table itself.
 *
 * Keyed on every member of `NUMERIC_VALUE_TYPES` and nothing else. The
 * equality is PINNED rather than typed — `NUMERIC_VALUE_TYPES` is a
 * `ReadonlySet<string>`, so no `satisfies` can express it — and
 * `numeric-column-representation.test.ts` fails in BOTH directions: a type
 * joining that class with no entry here, and an entry here naming a type that
 * left it. Without the pin a new member would resolve to `undefined` and each
 * producer would quietly keep its own old guess, which is the exact shape
 * #16318 exists to close.
 *
 * ⚠️ The driver's internal SQL aliases (`float`, `integer`, `int`) are NOT
 * members of this class and deliberately have no entry: they are not
 * `FieldType`s, nothing authorable produces them, and they keep the columns
 * they have always had.
 */
export const NUMERIC_COLUMN_REPRESENTATION: Readonly<Record<string, NumericColumnRepresentation>> = {
  // Open-range quantities.
  number: EXACT,
  // Money — the one member where the loss is a correctness question rather
  // than a display one, and the reason binary32 could not stay. ⛔ Not a
  // blanket `18,2`: the platform's own CLDR table carries 0-digit currencies
  // (JPY, KRW, ...) and 3-digit ones (BHD, KWD, ...), and its currency-code
  // schema deliberately fails OPEN for crypto and custom codes, which carry
  // more (see `currency-fraction-digits.ts`). A money column that fixes two
  // decimals is wrong for a set the platform declines to close.
  currency: EXACT,
  // ⚠️ A `percent` stores a 0-1 FRACTION unless the field declares `max > 1`
  // (`percentScaleOf`), so the legitimate value the ruling names — 33.333% —
  // reaches the column as `0.33333`, where `numeric(5,2)` rounded it to
  // `0.33`: 33% for 33.333%. Both storage scales are held exactly here.
  percent: EXACT,
  slider: EXACT,
  // The same 0-100 quantity as `percent`, which is why it took `percent`'s
  // NARROW shape in the sql format. It keeps sharing `percent`'s answer; the
  // shared answer is now the wide one.
  progress: EXACT,
  // A platform-computed roll-up: the SUM of child values, so it needs at least
  // what its children have, and it is the member with no write seam to refuse
  // an over-scale value on its behalf.
  summary: EXACT,
  // A star count. See the half-star block above.
  rating: { kind: 'integer' },
};

/**
 * The column a numeric field type takes, or `undefined` when the type is not a
 * member of this family at all — this table has NO opinion about those, and a
 * caller that gets `undefined` keeps whatever answer it already had.
 *
 * ⛔ Callers must not spell a fallback column for a member of this family: an
 * `undefined` for one would mean the caller's case labels and
 * `NUMERIC_VALUE_TYPES` have parted, and a silent default is the drift this
 * table closes. The pin holds the two equal.
 */
export function numericColumnFor(type: string | undefined): NumericColumnRepresentation | undefined {
  if (typeof type !== 'string' || !NUMERIC_VALUE_TYPES.has(type)) return undefined;
  return NUMERIC_COLUMN_REPRESENTATION[type];
}
