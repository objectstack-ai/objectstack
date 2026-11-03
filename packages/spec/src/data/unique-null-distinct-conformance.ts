// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for **NULL-distinct `unique`** (#29377) — the one
 * standard *"a NULL is not a key value"*, run on every driver.
 *
 * ## Why this table exists — a measurement, not a proposal
 *
 * PR #29339 (#29278) made `driver-mongodb` admit two records whose `unique`
 * field is `null`. Before it, that driver built `{ unique: true, sparse: true }`,
 * and a sparse index skips only documents that LACK the field: an explicit
 * `null` was indexed like a value, so the second record that cleared an
 * optional unique field was refused there and nowhere else. `driver-sql` and
 * `driver-memory` already admitted it, and the agreement was measured in that
 * PR — but no shared case-set asserted it, so the census
 * (`scripts/check-driver-conformance.mjs`) stayed green through the whole
 * divergence and would stay green through the next one. That is the gap
 * `value-roundtrip-conformance.ts` describes for value storage: no case-set,
 * no evidence.
 *
 * Every row below is a value some driver was **measured** to answer one way,
 * or a control that every driver answered the same way in that measurement.
 * The two in-process drivers were run on `origin/main` @ `f95d0dba`:
 *
 * - `driver-memory` — `InMemoryDriver` over both objects below, every case
 *   in order on one synced pair, judged by {@link uniqueNullDistinctDivergence}:
 *   10 of 10 agree. `memory-unique-constraint.ts` states the rule it
 *   implements: a NULL in any key part EXEMPTS the row.
 * - `driver-sql` — `SqlDriver` on `better-sqlite3`, the same run: 10 of 10
 *   agree, each refusal `SQLITE_CONSTRAINT_UNIQUE`. SQL `UNIQUE` is
 *   NULL-distinct by definition; the composite `UNIQUE (region, tag)` was
 *   measured on SQLite in #13239 too (quoted in `memory-unique-constraint.ts`).
 * - `driver-mongodb` — NOT run against a server for this table (no mongod
 *   binary was reachable). What stands are the real-mongod readings of
 *   PR #29339 (`mongodb-unique-null-distinct.test.ts`, mongod 8.3.7): two
 *   `null` admitted, two absent admitted, a non-null duplicate and two `''`
 *   refused with `E11000`, and a declared `(region, tag)` index admitting
 *   `(eu, null)` twice while refusing `(eu, t)` twice — the rows
 *   `single_null_null`, `single_absent_absent`, `single_equal_value`,
 *   `single_empty_string`, `compound_one_null` and `compound_equal`. The other
 *   four follow from the index shape that suite's server-free half pins: a
 *   `partialFilterExpression` that admits only non-NULL types on EVERY key
 *   part, so a NULL or a missing value in any one part leaves the row out of
 *   the index. The driver's own suite, when it adopts this table, is the
 *   measurement for those four.
 *
 * The three agree on every row that was run. They did not before PR #29339,
 * and the row that would have told them apart is marked.
 *
 * ## The contract this asserts
 *
 * SQL's rule, which the other two drivers reproduce: **a row whose unique key
 * has a NULL in ANY key part is exempt from the constraint.** `null` and an
 * absent value are the same NULL. `''` is a value, not a NULL — two empty
 * strings collide like any other equal pair. A compound key collides only when
 * every key part is non-NULL and equal.
 *
 * ## How a driver suite consumes this table
 *
 * Sync both objects of {@link UNIQUE_NULL_DISTINCT_OBJECTS} through the
 * driver's own `syncSchema`, then for each case:
 *
 * 1. write `c.first` through the driver's own `create()` — it must be
 *    admitted;
 * 2. write `c.second` the same way, and record `'admitted'` when it resolves
 *    and `'refused'` when it throws an error that `isUniqueViolationError`
 *    (`@objectstack/types`) recognises — ⛔ any OTHER error is neither, and is
 *    a failure of the case, never a refusal;
 * 3. count the rows of `c.object` whose `label` is `c.name`;
 * 4. hand both to {@link uniqueNullDistinctDivergence}, which answers `null`
 *    when the driver agreed.
 *
 * ⚠️ Step 2's judge is the shared predicate, not "it threw". The drivers'
 * refusals differ in shape (`driver-memory`: `UNIQUE_VIOLATION` / 409;
 * `driver-sql`: the dialect's own error; `driver-mongodb`: `E11000`, code
 * 11000) and `isUniqueViolationError` is the one place that recognises all of
 * them. A bare `Error` from an unrelated fault passes a "did it throw" pin and
 * says nothing about the constraint.
 *
 * ⚠️ Step 3 is not decoration. `driver-memory` before commit 56c093c4d LANDED a
 * colliding write; a driver can also refuse a write and keep it. The count is
 * the half that says what the store holds.
 *
 * Every non-NULL value in the table is distinct from every other case's, so a
 * suite may run every case on ONE synced pair of objects — under the contract
 * no case's rows can collide with another case's.
 *
 * ## What belongs here — one axis, like every sibling table
 *
 * **Which NULLs a `unique` key admits, and the controls that keep it a
 * constraint.** Deliberately absent:
 *
 * - **The scope of `unique`** — `'organization'` vs `'global'`, the tenant key
 *   part, the bare `true` that means different scopes on the two declaration
 *   surfaces (ADR-0120 D1, ADR-0131 D1). That is a different question, pinned
 *   per driver. Both objects below have no tenant column and both spell
 *   `'global'`, the one scope that means the same key on every driver with or
 *   without one.
 * - **The update door** — clearing a unique field to `null` by `update()`.
 *   PR #29339 measured it on `driver-mongodb`; the other two drivers were not
 *   measured for it, and a row with no measurement behind it does not belong
 *   in this table.
 * - **What a refusal says** — its column, message or envelope. Those are the
 *   driver's and the REST layer's (`uniqueViolationColumn`, ADR-0112).
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/29377 (this table)
 * @see https://github.com/objectstack-ai/objectstack/issues/29278 (the driver-mongodb divergence)
 */

/**
 * The two objects the cases are written through, as a driver's `syncSchema`
 * takes them.
 *
 * - `unique_null_single` carries a FIELD-level unique, `code`.
 * - `unique_null_compound` carries a DECLARED two-column unique index over
 *   `(region, tag)` — the only surface a compound key can be declared on.
 *
 * Two objects rather than one so that a compound case's absent `code` is never
 * a second question asked of the single-column constraint. Both scopes are
 * spelled `'global'` (see "What belongs here"); a bare `true` on a declared
 * index is refused since protocol 18 (ADR-0120 D1).
 */
export const UNIQUE_NULL_DISTINCT_OBJECTS = {
  unique_null_single: {
    name: 'unique_null_single',
    fields: {
      label: { type: 'text' },
      code: { type: 'text', unique: 'global' },
    },
  },
  unique_null_compound: {
    name: 'unique_null_compound',
    fields: {
      label: { type: 'text' },
      region: { type: 'text' },
      tag: { type: 'text' },
    },
    indexes: [{ fields: ['region', 'tag'], unique: 'global' }],
  },
} as const;

/** One case: two writes in order, and what the second one must answer. */
export interface UniqueNullDistinctCase {
  /** Stable identifier — each row's `label`, and usable as a test name. */
  readonly name: string;
  /** The object of {@link UNIQUE_NULL_DISTINCT_OBJECTS} both rows are written into. */
  readonly object: keyof typeof UNIQUE_NULL_DISTINCT_OBJECTS;
  /** The first row handed to `create()`. Every case expects it admitted. */
  readonly first: Readonly<Record<string, unknown>>;
  /** The second row handed to `create()`, after the first. */
  readonly second: Readonly<Record<string, unknown>>;
  /**
   * `'admitted'` — the second row lands and the object holds both;
   * `'refused'` — the second row is refused with the driver's unique refusal
   * and the object holds only the first.
   */
  readonly expected: 'admitted' | 'refused';
  /** Why the case is here — surfaced in failure output. */
  readonly note: string;
}

/** A case whose rows carry their own `label`, so a count by label isolates it. */
const pair = (
  name: string,
  object: UniqueNullDistinctCase['object'],
  first: Record<string, unknown>,
  second: Record<string, unknown>,
  expected: UniqueNullDistinctCase['expected'],
  note: string,
): UniqueNullDistinctCase => ({
  name,
  object,
  first: { label: name, ...first },
  second: { label: name, ...second },
  expected,
  note,
});

/** The cases. */
export const UNIQUE_NULL_DISTINCT_CASES: readonly UniqueNullDistinctCase[] = [
  // ── a single-column key ───────────────────────────────────────────────────
  pair(
    'single_null_null', 'unique_null_single', { code: null }, { code: null }, 'admitted',
    // [#29278] driver-mongodb refused this second row until PR #29339.
    'two explicit nulls — the row a sparse unique index refuses, because it indexes null like a value; '
      + 'driver-sql and driver-memory admitted it throughout',
  ),
  pair(
    'single_absent_absent', 'unique_null_single', {}, {}, 'admitted',
    'two rows that omit the field — control: every driver admitted it, the old sparse index included',
  ),
  pair(
    'single_null_absent', 'unique_null_single', { code: null }, {}, 'admitted',
    'an absent value is the same NULL as an explicit null, so neither is a key value',
  ),
  pair(
    'single_equal_value', 'unique_null_single', { code: 'und-x' }, { code: 'und-x' }, 'refused',
    'control: two equal non-null values still collide — a driver that enforces nothing passes every '
      + 'admitted row and fails this one',
  ),
  pair(
    'single_empty_string', 'unique_null_single', { code: '' }, { code: '' }, 'refused',
    "'' is a value, not a NULL: refused on all three drivers — a driver that folds '' onto NULL admits it",
  ),

  // ── a compound key ────────────────────────────────────────────────────────
  pair(
    'compound_one_null', 'unique_null_compound',
    { region: 'und-r1', tag: null }, { region: 'und-r1', tag: null }, 'admitted',
    // Measured: driver-mongodb on a real mongod 8.3.7 (PR #29339), driver-sql on
    // SQLite (#13239, and again for this table), driver-memory for this table.
    'one NULL key part exempts the row — the answer all three drivers were measured to give',
  ),
  pair(
    'compound_leading_null', 'unique_null_compound',
    { region: null, tag: 'und-t2' }, { region: null, tag: 'und-t2' }, 'admitted',
    'the NULL in the LEADING key part exempts the row too — a key folded onto its non-NULL parts refuses it',
  ),
  pair(
    'compound_one_absent', 'unique_null_compound', { region: 'und-r3' }, { region: 'und-r3' }, 'admitted',
    'an absent key part is the same NULL as an explicit null',
  ),
  pair(
    'compound_equal', 'unique_null_compound',
    { region: 'und-r4', tag: 'und-t4' }, { region: 'und-r4', tag: 'und-t4' }, 'refused',
    'control: every key part non-NULL and equal — the compound key still collides',
  ),
  pair(
    'compound_differs_in_one_part', 'unique_null_compound',
    { region: 'und-r5', tag: 'und-t5a' }, { region: 'und-r5', tag: 'und-t5b' }, 'admitted',
    'control: equal on one key part only — a key built over the first column alone refuses it',
  ),
] as const;

/**
 * The verdict for one case, computed identically by every consuming suite.
 *
 * A shared judge for the reason the table itself is shared (see
 * `valueRoundTripDivergence`): six suites each spelling "agreed" their own way
 * is six definitions. `second` is what the second write answered —
 * `'admitted'`, or `'refused'` ONLY when `isUniqueViolationError` recognised
 * the error — and `stored` is how many rows labelled `c.name` the object holds
 * afterwards. Returns `null` when the driver agreed, or the human-readable
 * divergence when it did not.
 */
export function uniqueNullDistinctDivergence(
  c: UniqueNullDistinctCase,
  second: 'admitted' | 'refused',
  stored: number,
): string | null {
  const expectedStored = c.expected === 'admitted' ? 2 : 1;
  if (second === c.expected && stored === expectedStored) return null;
  return (
    `${c.name} (${c.object}): wrote ${JSON.stringify(c.first)} then ${JSON.stringify(c.second)}; `
    + `expected the second ${c.expected} and ${expectedStored} row(s) stored, `
    + `got the second ${second} and ${stored} row(s) stored`
  );
}
