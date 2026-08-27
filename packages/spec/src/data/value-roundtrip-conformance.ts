// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for **value storage round-trip** (#12393) — the
 * one standard *"what you wrote is what you read back"*, run on every driver.
 *
 * ## Why this table exists — a measurement, not a proposal
 *
 * The driver-conformance census (`scripts/check-driver-conformance.mjs`) was
 * green at 9 of 9 dialect-scored cells after #12136 promoted `MATRIXED`, and
 * **none of its nine case-sets was about value storage**. The nine cover
 * filters, temporal form, pagination and aggregation — every one of them a
 * question about *which rows come back*, none about *what the values in them
 * are*. So that green was not weak evidence about a round-trip defect; it was
 * **no evidence at all**, and it would have stayed green forever with the
 * defect in place.
 *
 * That is why this family kept arriving one card at a time:
 *
 * | card | the same question, one instance at a time |
 * |---|---|
 * | #12380 | SQLite's `Field.json` codec was not injective — `'123'` read back as the number `123`; PG/MySQL disagreed |
 * | #11535 | a multi-value field read back as the string `'["x","y"]'` |
 * | #11782 | MySQL answered `1`/`0` for a declared boolean |
 * | #10995 | PG json values bound without `JSON.stringify` — the write half |
 *
 * Every value below is a value some driver was **measured** to change, or a
 * control that stayed faithful in the same measurement. Nothing here was
 * invented to round out a table.
 *
 * ## The contract this asserts, and why it is a contract argument
 *
 * `json`'s stored contract is `z.unknown()` — deliberately open (see
 * `valueSchemaFor` in `./field-value.zod`: *"openness is now an explicit
 * decision, not an accident of nobody checking"*). An explicitly-open contract
 * admits **both** `123` and `'123'` as legal values of one field, so no driver
 * has license to collapse them onto one representation. The scalar columns are
 * the same argument in its easy direction: a declared `boolean` that reads back
 * as `1` has changed the value's type, and the contract says the value is a
 * boolean.
 *
 * ⇒ The standard is **injectivity**: distinct written values must remain
 * distinguishable on read. {@link VALUE_ROUNDTRIP_COLLISION_PAIRS} is that
 * property stated directly, and it is the half a per-value assertion can miss —
 * two rows can each look plausible and still be the same bytes.
 *
 * ## How a driver suite consumes this table
 *
 * Write {@link VALUE_ROUNDTRIP_ROWS} through the driver's own `create()`, read
 * them back through its own `find()`, and for each case assert **the type and
 * the value**:
 *
 * ```ts
 * expect(typeof read).toBe(typeof c.wrote);   // FIRST — see below
 * expect(read).toStrictEqual(c.wrote);
 * ```
 *
 * ⚠️ The `typeof` pin is not decoration and it is not redundant with
 * `toStrictEqual`. The before-state of every card in the table above was a
 * **wrong type carrying a right-looking value**: `'123'` read back as `123`
 * passes `toEqual`-style coercion, every truthiness pin and most snapshot
 * comparisons, which is exactly how those defects survived long enough to be
 * found by reading source. A round-trip pin that does not compare types is not
 * a round-trip pin. (`toStrictEqual` does compare types; the separate pin
 * exists so the FAILURE names the type, which is the diagnosis.)
 *
 * A driver with no server available in CI (`driver-mongodb`, whose real-mongod
 * suites are opt-in since #5517) makes the same judgement server-free, at the
 * seam where its values are actually encoded — for that driver, BSON
 * serialize/deserialize. That is the accepted substitute its sibling
 * conformance suites already use, and it is stated in the suite rather than
 * implied here.
 *
 * ## What belongs here — one axis, like every sibling table
 *
 * **Value storage form only.** Explicitly the subject of other tables, and
 * deliberately absent from this one:
 *
 * - **Temporal storage form** — `TEMPORAL_CASES` / `TEMPORAL_TIME_CASES`
 *   (ADR-0053, #3994). Date/datetime/time are the one value class with a
 *   *canonical* storage form the platform declares; that is a different
 *   question from "the driver did not change it", and it already has two
 *   tables.
 * - **Aggregated values** — `AGGREGATION_CASES` (#6409). `avg`/`sum` over a
 *   boolean (#11065 / #11151) is a value a driver *computes*, not one it
 *   stored.
 * - **Which rows come back** — the filter, pagination and comparand tables.
 *
 * ⛔ **Also deliberately absent: an own key holding `undefined`.** A declared
 * field written as an explicit `undefined` comes back from the JS-backed
 * drivers as an own key holding `undefined` — neither "absent" nor "holds a
 * value" — and it is an **open, tracked** divergence (#9276, on hold with a
 * named restart condition), not a defect this table discovered. Putting it here
 * would ship a case-set that is red on `driver-memory` by construction, which
 * is precisely the escape hatch #12136's ruling closed: *a gate that ships red
 * is worse than one that ships honest*. When #9276 lands, its value class
 * belongs in this table and the case that proves it belongs in this file.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/12393 (this table)
 * @see https://github.com/objectstack-ai/objectstack/issues/12380 (the measured boundary set)
 * @see https://github.com/objectstack-ai/objectstack/issues/9276 (the value class deliberately excluded)
 */

/** The declared column a case writes into. */
export type ValueRoundTripColumn = 'v_json' | 'v_multi' | 'v_string' | 'v_number' | 'v_boolean';

/**
 * The object the cases are written through, as a driver's `initObjects()` takes
 * it.
 *
 * One column per declared value class rather than one object per class: a
 * single fixture is one `create()` per row on every driver, and it keeps the
 * collision pairs — which span classes — expressible in one read.
 *
 * `v_multi` is `multiple: true` on an ordinary string field. That is the
 * #11535 shape and it is not a synonym for `v_json`: on the SQL family
 * `multiple` decides the column type **before** the type switch runs, so a
 * multi-value string and a declared `json` reach the JSON storage path by two
 * different routes and can diverge independently.
 */
export const VALUE_ROUNDTRIP_FIELDS = {
  label: { type: 'string' },
  v_json: { type: 'json' },
  v_multi: { type: 'string', multiple: true },
  v_string: { type: 'string' },
  v_number: { type: 'number' },
  v_boolean: { type: 'boolean' },
} as const;

/** A row in the round-trip fixture: one written value, in one declared column. */
export interface ValueRoundTripCase {
  /** Stable identifier — the row's `label`, and usable as a test name. */
  readonly name: string;
  /** Which declared column this value is written into. */
  readonly column: ValueRoundTripColumn;
  /** The exact JS value handed to `create()`. The read must `toStrictEqual` it. */
  readonly wrote: unknown;
  /** Why the case is here — surfaced in failure output. */
  readonly note: string;
}

/**
 * The cases.
 *
 * The `v_json` block is #12380's measured boundary set: every string in it has
 * content that is valid JSON or is number-like (or both) — the two classes the
 * pre-fix SQLite encoding destroyed — plus the ordinary strings that always
 * worked, kept as controls so a suite that goes red says *which* class broke.
 */
export const VALUE_ROUNDTRIP_CASES: readonly ValueRoundTripCase[] = [
  // ── json: strings whose CONTENT is valid JSON (the read-side class) ────────
  { name: 's_true', column: 'v_json', wrote: 'true', note: 'string whose content parses as a boolean' },
  { name: 's_false', column: 'v_json', wrote: 'false', note: 'string whose content parses as a boolean' },
  { name: 's_null', column: 'v_json', wrote: 'null', note: 'string whose content parses as null' },
  { name: 's_arr', column: 'v_json', wrote: '[]', note: 'string whose content parses as an array' },
  { name: 's_obj', column: 'v_json', wrote: '{"a":1}', note: 'string whose content parses as an object' },
  { name: 's_quoted', column: 'v_json', wrote: '"quoted"', note: 'string whose content parses as a string' },

  // ── json: number-like strings (the write-side class) ──────────────────────
  //
  // These are the ones a read-path change cannot repair: on SQLite a `json`
  // column carries NUMERIC affinity, so a bare number-like string was converted
  // to INTEGER/REAL before storage. They are here because a driver that gets
  // them wrong is destroying data, not misreporting it.
  { name: 's_123', column: 'v_json', wrote: '123', note: 'number-like string' },
  { name: 's_pad', column: 'v_json', wrote: '  123  ', note: 'number-like string with padding' },
  { name: 's_0123', column: 'v_json', wrote: '0123', note: 'number-like string, leading zero' },
  { name: 's_1e5', column: 'v_json', wrote: '1e5', note: 'number-like string, exponent form' },
  { name: 's_1p0', column: 'v_json', wrote: '1.0', note: 'number-like string, trailing zero' },
  { name: 's_neg0', column: 'v_json', wrote: '-0', note: 'number-like string, negative zero' },

  // ── json: ordinary strings — controls that were faithful throughout ───────
  { name: 's_empty', column: 'v_json', wrote: '', note: 'empty string' },
  { name: 's_tz', column: 'v_json', wrote: 'America/New_York', note: 'ordinary string' },
  { name: 's_bad', column: 'v_json', wrote: '{bad json', note: 'string that does not parse' },
  { name: 's_nan', column: 'v_json', wrote: 'NaN', note: 'string that is not valid JSON' },

  // ── json: native (non-string) values ──────────────────────────────────────
  { name: 'n_true', column: 'v_json', wrote: true, note: 'native boolean inside json' },
  { name: 'n_false', column: 'v_json', wrote: false, note: 'native boolean inside json' },
  { name: 'n_int', column: 'v_json', wrote: 123, note: 'native integer' },
  { name: 'n_real', column: 'v_json', wrote: 1.5, note: 'native real' },
  { name: 'n_null', column: 'v_json', wrote: null, note: 'native null' },
  { name: 'n_str', column: 'v_json', wrote: 'plain', note: 'native plain string' },
  { name: 'n_obj', column: 'v_json', wrote: { a: 1 }, note: 'native object' },
  { name: 'n_arr', column: 'v_json', wrote: [1, 2], note: 'native array' },
  { name: 'n_arr_empty', column: 'v_json', wrote: [], note: 'native empty array' },
  { name: 'n_quoted', column: 'v_json', wrote: 'quoted', note: 'native string — the collision twin of s_quoted' },
  {
    name: 'n_nested',
    column: 'v_json',
    wrote: { a: [1, { b: 'x' }], c: null },
    note: 'nested object — a codec that re-encodes only the top level shows up here',
  },

  // ── multi-value (#11535): stored as JSON, reached by a different route ────
  {
    name: 'm_two',
    column: 'v_multi',
    wrote: ['userA', 'userB'],
    note: "#11535's exact shape: the array that came back as the string '[\"userA\",\"userB\"]'",
  },
  { name: 'm_one', column: 'v_multi', wrote: ['solo'], note: 'single-element array must not degrade to its element' },
  { name: 'm_empty', column: 'v_multi', wrote: [], note: 'empty array must not degrade to null' },
  {
    name: 'm_numlike',
    column: 'v_multi',
    wrote: ['123', '0123'],
    note: 'members are number-like strings — the json class, inside the multi-value route',
  },

  // ── scalar columns: the value class stated in the declaration ─────────────
  { name: 'b_true', column: 'v_boolean', wrote: true, note: 'declared boolean — #11782 read this back as 1 on MySQL' },
  { name: 'b_false', column: 'v_boolean', wrote: false, note: 'declared boolean — the 0 half of #11782' },
  { name: 'num_int', column: 'v_number', wrote: 42, note: 'declared number, integral' },
  { name: 'num_real', column: 'v_number', wrote: 1.5, note: 'declared number, fractional' },
  { name: 'num_zero', column: 'v_number', wrote: 0, note: 'zero must survive as a number, not become null' },
  { name: 'num_neg', column: 'v_number', wrote: -7.25, note: 'declared number, negative fractional' },
  {
    name: 'str_numlike',
    column: 'v_string',
    wrote: '00123',
    note: 'a declared STRING holding a number-like value must stay a string',
  },
  {
    name: 'str_jsonlike',
    column: 'v_string',
    wrote: '{"a":1}',
    note: 'a declared STRING holding JSON text must not be parsed on the way out',
  },
  { name: 'str_plain', column: 'v_string', wrote: 'plain', note: 'ordinary string — the control' },
  { name: 'str_empty', column: 'v_string', wrote: '', note: 'empty string must not become null' },
] as const;

/**
 * The fixture as rows, one per case: the case's own column carries its value
 * and no other declared column is written.
 *
 * Deliberately one column per row rather than a dense table. A row that wrote
 * every column at once could not tell "this driver changed the value" from
 * "this driver moved it into the wrong column", and the second failure is one
 * the JSON-storage path can actually produce.
 */
export const VALUE_ROUNDTRIP_ROWS: readonly Record<string, unknown>[] = VALUE_ROUNDTRIP_CASES.map(
  (c) => ({ label: c.name, [c.column]: c.wrote }),
);

/**
 * Pairs that must remain **distinguishable on read** — the injectivity half.
 *
 * Each pair is a string and the native value whose JSON encoding it looks like.
 * Three of these collided on SQLite before #12380 (`'123'`/`123`, `'[]'`/`[]`,
 * `'{"a":1}'`/`{a:1}`) and a fourth collided on read (`'null'`/`null`); all
 * were distinct on Postgres and MySQL, which is what made it a driver defect
 * rather than a platform decision.
 *
 * ⚠️ This is not implied by the per-case assertions. A driver that answered
 * every case with the *string* form would pass half of them and fail the other
 * half — but a driver that is merely LOSSY in one direction can pass every
 * individual case whose written value happens to be the surviving form. The
 * pair check asks the question the per-value check cannot.
 */
export const VALUE_ROUNDTRIP_COLLISION_PAIRS: readonly (readonly [string, string])[] = [
  ['s_123', 'n_int'],
  ['s_arr', 'n_arr_empty'],
  ['s_obj', 'n_obj'],
  ['s_true', 'n_true'],
  ['s_null', 'n_null'],
  ['s_quoted', 'n_quoted'],
] as const;

/**
 * The verdict for one case, computed identically by every consuming suite.
 *
 * A shared judge rather than a per-suite `expect` chain, for the reason the
 * table itself is shared: five suites each spelling "faithful" their own way is
 * five definitions, and the one that is subtly weaker is the one that stays
 * green. Returns `null` when the round trip was faithful, or the human-readable
 * divergence when it was not.
 */
export function valueRoundTripDivergence(c: ValueRoundTripCase, read: unknown): string | null {
  const wroteType = typeof c.wrote;
  const readType = typeof read;
  const same =
    readType === wroteType && JSON.stringify(read ?? null) === JSON.stringify(c.wrote ?? null);
  if (same) return null;
  return (
    `${c.name} (${c.column}): wrote ${JSON.stringify(c.wrote)} (${wroteType}), ` +
    `read ${JSON.stringify(read)} (${readType})`
  );
}
