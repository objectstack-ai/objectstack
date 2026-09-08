// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The NUMERIC column family's physical representation — one explicit,
 * per-field-type table that every producer of DDL reads (#16318).
 *
 * Ruled C ∩ ④ (maintainer, decision batch #86, 2026-09-08). ⛔ Quoted, not
 * translated:
 *
 * > One explicit per-field-type physical-representation table lives in
 * > `packages/spec` (the protocol is the baseline) and both producers —
 * > `SqlDriver.createColumn` and `os generate migration` (sql + typescript
 * > formats) — read it … **New tables only**: no migration of existing
 * > columns (「不考虑现有数据」).
 *
 * ## The divergence this closes, measured rather than argued
 *
 * One object, seven plain numeric declarations, three producers, driven into
 * one live PostgreSQL 16.13 and read back out of `information_schema.columns`
 * — `numeric_precision` / `numeric_scale` included, which is the half the
 * original report's `data_type` read hid:
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
 * 7 of 7 diverge, and six of them are a THREE-way split, not the two-way one
 * the card reported: `table.decimal(name)` with no arguments is knex's
 * `decimal(8, 2)`, so the typescript format never agreed with the sql format
 * either. Every one of the three is lossy, in three different directions:
 *
 *   - `real` is IEEE-754 binary32. Measured: `1234567.89` reads back as
 *     `1.2345679e+06` — nine cents gone from one value, silently.
 *   - `numeric(8,2)` REFUSES `1234567.89` outright (`numeric field overflow`),
 *     so a money value the platform stores today cannot be stored in a table
 *     the typescript format generates for the same object.
 *   - `numeric(5,2)` and `numeric(18,2)` silently ROUND — `33.333 → 33.33`,
 *     `33.336 → 33.34`. ⚠️ ROUND, not truncate: the original inference was
 *     read off the DDL literal and named truncation. The direction it was
 *     used for is unchanged (the loss is silent either way), and the platform
 *     has already ruled on exactly this behaviour — see the `scale` block
 *     below.
 *
 * ## Why a scale is not free to invent: `scale` is REFUSED, never rounded
 *
 * The write seam's own contract, and the reason no member of this family gets
 * a narrow scale "because two decimals is what money has":
 * `record-validator.ts` states it as a maintainer ruling of 2026-08-11
 * (#7501) — "an over-scale value is refused the way an out-of-range one is;
 * **silent rounding is silently altering data**". A `numeric(p, s)` column
 * whose `s` is narrower than what that seam accepts does the one thing the
 * ruling forbids, on the way to disk, with nobody to tell. So the column's
 * scale is chosen to be at least as wide as the seam's, never narrower.
 *
 * ## Where {@link DEFAULT_NUMERIC_SCALE} comes from — measured, not chosen
 *
 * A value reaches the column as a JavaScript number (`valueSchemaFor` gives
 * every member of this family `z.number().finite()`), so the widest thing a
 * column has to preserve is an IEEE-754 **binary64** significand — at most 17
 * significant decimal digits in its shortest round-trip form. Candidate widths
 * were driven against a corpus of fourteen values (the card's own, the money
 * magnitudes, one satoshi, one basis point, a 16-significant-digit integer and
 * a 16-significant-digit fraction), each written and read back as `float8`:
 *
 * ```
 *   numeric(5,2)    12/14 lost or refused      real              12/14
 *   numeric(8,2)    12/14 lost or refused      numeric(38,6)      3/14
 *   numeric(18,2)    8/14 lost                 numeric(38,8)      2/14
 *   numeric(38,10)   2/14 lost                 numeric(38,17)     0/14
 * ```
 *
 * 17 is therefore not a taste: it is the narrowest scale on that sweep that
 * loses nothing, and it is the digit count an IEEE-754 binary64 needs.
 *
 * ## Where {@link NUMERIC_COLUMN_PRECISION} comes from — the PORTABLE ceiling
 *
 * ⚠️ An unconstrained `numeric` would be the honest shape on PostgreSQL, and
 * it is NOT portable: measured through knex's own compilers, `decimal(name,
 * null)` compiles to `decimal` on `pg`, to `float` on `better-sqlite3`, and
 * **throws** on `mysql2` ("Specifying no precision on decimal columns is not
 * supported") — knex refuses it there because MySQL's own default for a bare
 * `DECIMAL` is `DECIMAL(10,0)`, an INTEGER column. A stated pair is the only
 * spelling all three dialects accept, which is what the ruling asked for.
 *
 * MySQL caps `DECIMAL` at 65 total digits and a scale of 30; PostgreSQL and
 * SQLite impose no lower bound. `38` sits inside that cap and leaves 21 digits
 * left of the point with the default scale — comfortably past
 * `Number.MAX_SAFE_INTEGER`'s 16, so no value a JS number can carry exactly is
 * refused for magnitude.
 *
 * ## SQLite, per type — the constraint the card raised, answered
 *
 * `SqlDriver.createColumn`'s float arm records why `rating`/`slider`/`progress`
 * were put in it: without an explicit case they fell to `table.string`, the
 * column took TEXT affinity, and SQLite stored `'4'` rather than `4`. That
 * hazard is untouched here, and the measurement says so in the only terms that
 * matter — knex compiles **`table.decimal(...)` and `table.float(...)` to the
 * identical `float` column on SQLite**, so every type this table moves out of
 * the float arm emits byte-identical SQLite DDL and keeps REAL affinity.
 * Driven on better-sqlite3, one row per declared type:
 *
 * ```
 *   declared          4        4.5      33.333    0.33333
 *   real / float      real:4   real:4.5 real:33.333 real:0.33333
 *   decimal(38,17)    int:4    real:4.5 real:33.333 real:0.33333   <- NUMERIC affinity
 *   integer           int:4    real:4.5 real:33.333 real:0.33333
 *   varchar(255)      text:"4.0"  ...                              <- the fossil's own leak
 * ```
 *
 * Two per-type consequences, stated rather than assumed:
 *
 *   - The six decimal members take NUMERIC affinity instead of REAL. SQLite
 *     applies no precision or scale, converts a lossless real to an integer
 *     storage class (`4` reads back as the integer `4`, not `4.0`), and
 *     converts nothing else — no truncation, no TEXT.
 *   - `rating` takes INTEGER affinity, which on SQLite does NOT refuse a
 *     fractional value: `4.5` is stored as REAL `4.5`. So the half-star
 *     refusal below is a PostgreSQL/MySQL effect and SQLite keeps accepting
 *     what it accepts today.
 *
 * ## `rating` — integer, and the half-star need was measured
 *
 * The ruling made `rating` integer "unless the executor measures a half-star
 * need". There is none to measure: `allowHalf` was RETIRED in 2026-06 as dead
 * surface with no runtime reader (see `field.zod.ts`'s prune block and
 * `docs/audits/2026-06-dead-surface-disposition-plan.md`), and `Field.rating`
 * takes a star COUNT (`rating(max = 5)`) and nothing else. What remains
 * reachable is the generic `scale` key, which the record validator's numeric
 * branch does enforce for `rating` — so a field that declares one takes the
 * exact-decimal answer and no column ever refuses a value that seam accepts.
 *
 * ⛔ This table decides what a NEW column is created as, and nothing else. It
 * retypes no existing column (the schema sync is additive), and no drift
 * finding reads it — `schema-drift.ts`'s base-type branch is gated on
 * multi-value fields over textual columns and compares no numeric type.
 */

import { NUMERIC_VALUE_TYPES } from './field-value.zod';

/**
 * Total digits for every exact-decimal column this table produces.
 *
 * See the provenance block above: the portable ceiling is MySQL's
 * `DECIMAL(65, 30)`, and 38 leaves 21 digits left of the point at the default
 * scale — past `Number.MAX_SAFE_INTEGER`'s 16.
 */
export const NUMERIC_COLUMN_PRECISION = 38;

/**
 * Decimal places for a member of this family that declares no `scale`.
 *
 * 17 = the significant decimal digits an IEEE-754 binary64 round-trips, and
 * the narrowest scale measured to lose nothing on the fourteen-value corpus
 * above.
 */
export const DEFAULT_NUMERIC_SCALE = 17;

/**
 * The widest scale every dialect this platform speaks accepts (MySQL's cap on
 * `DECIMAL`). A declaration past it is not carried into the column — it would
 * make the DDL itself unportable — and it is not lost either: the write seam
 * still enforces the declared `scale` by rejection.
 */
export const MAX_NUMERIC_COLUMN_SCALE = 30;

/**
 * What a numeric field's column IS, kept as named answers rather than a bare
 * pair — the same reason `generate.ts`'s `VarcharAnswer` is three answers and
 * not a number: `integer` is not "a decimal with scale 0", it is a different
 * column type with a different refusal.
 */
export type NumericColumnRepresentation =
  | { readonly kind: 'integer' }
  | { readonly kind: 'exact'; readonly precision: number; readonly scale: number };

/** The subset of field metadata the representation is resolvable from. */
export interface NumericColumnFieldMeta {
  readonly type?: string;
  /** Declared decimal places — `FieldSchema.scale`, a non-negative integer. */
  readonly scale?: unknown;
}

/**
 * The per-type BASELINE — the answer for a field that declares no `scale`.
 *
 * Keyed on every member of `NUMERIC_VALUE_TYPES` and nothing else. The
 * equality is PINNED rather than typed — `NUMERIC_VALUE_TYPES` is a
 * `ReadonlySet<string>`, so no `satisfies` can express it — and
 * `numeric-column-representation.test.ts` fails in BOTH directions: a type
 * joining that class with no entry here, and an entry here naming a type that
 * left it. Without the pin a new member would fall through to `undefined` and
 * each producer would silently keep its own old guess.
 */
const BASELINE: Readonly<Record<string, NumericColumnRepresentation>> = {
  // Open-range quantities. Exact decimal at the full binary64 significand.
  number: { kind: 'exact', precision: NUMERIC_COLUMN_PRECISION, scale: DEFAULT_NUMERIC_SCALE },
  // Money. The one member where the loss is a correctness question rather than
  // a display one, and the reason binary32 could not stay: ⛔ not a blanket
  // `18,2` either — a currency code the schema accepts is not always a 2-digit
  // one (ISO 4217 carries 0- and 3-digit currencies, and crypto codes fail open
  // at 8 and 18; see `currency-fraction-digits.ts`).
  currency: { kind: 'exact', precision: NUMERIC_COLUMN_PRECISION, scale: DEFAULT_NUMERIC_SCALE },
  // ⚠️ A `percent` stores a 0–1 FRACTION unless the field declares `max > 1`
  // ({@link percentScaleOf}), so the legitimate value the ruling names —
  // 33.333% — reaches the column as `0.33333`, and `numeric(5,2)` rounded it to
  // `0.33`: three significant digits, i.e. 33% for 33.333%.
  percent: { kind: 'exact', precision: NUMERIC_COLUMN_PRECISION, scale: DEFAULT_NUMERIC_SCALE },
  slider: { kind: 'exact', precision: NUMERIC_COLUMN_PRECISION, scale: DEFAULT_NUMERIC_SCALE },
  // Same 0–100 quantity as `percent`, and it took `percent`'s narrow shape in
  // the sql format for exactly that reason. It keeps sharing the answer — the
  // wide one.
  progress: { kind: 'exact', precision: NUMERIC_COLUMN_PRECISION, scale: DEFAULT_NUMERIC_SCALE },
  // Platform-computed roll-up. It is the SUM of child values, so it needs at
  // least what its children have; anything narrower rounds an addend.
  summary: { kind: 'exact', precision: NUMERIC_COLUMN_PRECISION, scale: DEFAULT_NUMERIC_SCALE },
  // A star count. See the half-star block above — the capability was retired,
  // and a field that declares a `scale` still takes the exact answer below.
  rating: { kind: 'integer' },
};

/**
 * The column a numeric field takes, or `undefined` when the field is not a
 * member of this family at all (this table has NO opinion about those — the
 * caller keeps whatever answer it already had).
 *
 * The declaration is read the way `SqlDriver.declaredVarcharLength` reads
 * `maxLength`: a `scale` that is not a well-formed, portable digit count is
 * NOT a declaration, and a malformed one leaves the baseline in place rather
 * than being repaired into some invented meaning (the #8321 house rule).
 */
export function numericColumnFor(
  field: NumericColumnFieldMeta | undefined,
): NumericColumnRepresentation | undefined {
  const type = field?.type;
  if (typeof type !== 'string' || !NUMERIC_VALUE_TYPES.has(type)) return undefined;
  const declared = field?.scale;
  if (
    typeof declared === 'number' &&
    Number.isInteger(declared) &&
    declared >= 0 &&
    declared <= MAX_NUMERIC_COLUMN_SCALE
  ) {
    return { kind: 'exact', precision: NUMERIC_COLUMN_PRECISION, scale: declared };
  }
  return BASELINE[type];
}
