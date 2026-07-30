// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for **temporal filter semantics** — the single
 * source of truth every filter backend is checked against (ADR-0053 D-A3).
 *
 * The twin of {@link FILTER_LOGIC_CASES}, built for the same reason and after
 * the same kind of history. One temporal comparison is evaluated by six
 * independent implementations:
 *
 * | Backend | Entry point |
 * |---|---|
 * | SQL compiler | `driver-sql` `applyFilterCondition` (+ `driver-sqlite-wasm`) |
 * | In-memory store | `driver-memory` `convertToMongoQuery` → mingo |
 * | Document store | `driver-mongodb` `translateFilter` |
 * | Analytics raw SQL | `service-analytics` `NativeSQLStrategy` |
 * | Draft preview | `service-analytics` `preview-evaluator` |
 * | RLS write-side `check` | `formula` `matchesFilterCondition` |
 *
 * They disagreed four times, and every time a human found it by accident:
 * #3650 (the window was dropped entirely), #3773 (buckets collapsed to NULL),
 * #3777 (a bare-day upper bound dropped the final day — the default dashboard
 * configuration), #4047 (cross-type comparison matched nothing at all on the
 * non-SQL drivers). Each fix left a suite proving *its own* issue, with its own
 * fixture; nothing held the backends to one standard, so the fifth divergence
 * had nowhere to fail.
 *
 * Adding a case here adds it to every backend at once. That is the point.
 *
 * # What belongs here
 *
 * Only rules **every** backend must agree on: what a comparand *denotes*.
 * Storage form is deliberately out of scope — it is per-dialect by design
 * (ADR-0053 D-B/D-E: canonical UTC text on SQL, BSON `Date` on mongo), so it is
 * asserted in each driver's own suite. What is shared is the *semantics* those
 * storage forms have to preserve.
 *
 * # Why the values are strings
 *
 * Every row value is a string in the platform's wire form — canonical UTC ISO
 * for `datetime`, `YYYY-MM-DD` for `date`. That is what lets one table serve
 * both the typed backends (which coerce it into their storage form on write)
 * and the type-blind ones (`formula`, the preview evaluator), which see a bare
 * record with no schema to consult. A backend that needs richer input builds it
 * from these strings; none needs less.
 *
 * # One cell is NOT shared: `$gt` with a bare day on a `datetime` column
 *
 * Measured, not assumed. A typed backend anchors the bound to midnight, so a
 * value sitting exactly ON midnight is excluded:
 *
 *     at > '2026-07-28'  →  at > '2026-07-28T00:00:00.000Z'  →  excludes 00:00
 *
 * A type-blind one compares the raw strings, and `'2026-07-28T00:00:00.000Z'`
 * sorts AFTER `'2026-07-28'` on the shared prefix, so it keeps that row.
 *
 * The gap is irreducible without field types. The trick that makes the upper
 * bound type-blind — rewriting `<= day` as `< nextDay` — has no lower-bound
 * analogue: anchoring the bound to `…T00:00:00.000Z` would fix `datetime` and
 * break `date`, because `'2026-07-28' >= '2026-07-28T00:00:00.000Z'` is false.
 *
 * It bites only a value stored at exactly 00:00:00.000 under strict-greater, so
 * `$gt` is asserted here on the `date` column (where every backend agrees) and
 * the `datetime` cell is left to the typed drivers' own suites. `$gte` is
 * shared: both readings include the midnight row, so they agree by luck of the
 * boundary being inclusive — which is worth pinning precisely because it is
 * luck. Tracked separately rather than papered over.
 */

import type { FilterCondition } from './filter.zod';

/**
 * A row in the temporal fixture.
 *
 * `at` is a `Field.datetime` (an instant) and `on` is a `Field.date` (a
 * timezone-naive calendar day); the two carry the SAME calendar day per row, so
 * a case can be run against either column and the difference in result is
 * attributable to the field type rather than to the data.
 */
export interface TemporalRow {
  id: string;
  /** `Field.datetime` — canonical UTC ISO. */
  at: string;
  /** `Field.date` — the calendar day of `at`, timezone-naive. */
  on: string;
  /** Why the row is in the fixture — surfaced when a case fails. */
  why: string;
}

/**
 * The fixture. Every row exists to make one boundary decidable, and the times
 * of day are chosen so a midnight-anchored bound and a whole-day bound cannot
 * return the same set: `d_open` sits exactly ON midnight, `d_mid`/`d_late`
 * strictly after it, and `d_next` on the next midnight — the exclusive edge.
 */
export const TEMPORAL_ROWS: readonly TemporalRow[] = [
  { id: 'a_old',   at: '2026-04-19T10:00:00.000Z', on: '2026-04-19', why: 'well before any window here' },
  { id: 'b_prev',  at: '2026-07-27T14:00:00.000Z', on: '2026-07-27', why: 'the day before the boundary day' },
  { id: 'c_open',  at: '2026-07-28T00:00:00.000Z', on: '2026-07-28', why: 'boundary day at exactly 00:00 — the only instant a midnight-anchored bound keeps' },
  { id: 'd_mid',   at: '2026-07-28T09:15:00.000Z', on: '2026-07-28', why: 'boundary day, morning — dropped by the #3777 bug' },
  { id: 'e_late',  at: '2026-07-28T21:40:00.000Z', on: '2026-07-28', why: 'boundary day, evening — dropped by the #3777 bug' },
  { id: 'f_next',  at: '2026-07-29T00:00:00.000Z', on: '2026-07-29', why: 'next midnight — the exclusive edge a half-open bound must NOT keep' },
  { id: 'g_eom',   at: '2026-07-31T23:59:59.999Z', on: '2026-07-31', why: 'last representable instant of a month — month rollover' },
  { id: 'h_leap',  at: '2024-02-29T12:00:00.000Z', on: '2024-02-29', why: 'leap day — February rollover' },
] as const;

/** Which declared field type a case filters on. */
export type TemporalFieldKind = 'datetime' | 'date';

/** One conformance case: a filter on one column, and the ids it must match. */
export interface TemporalCase {
  /** Stable identifier, usable as a test name. */
  name: string;
  /**
   * Which fixture column — and therefore which declared field type — the
   * filter is applied to. A typed backend declares the column accordingly; a
   * type-blind one just reads the property.
   */
  field: 'at' | 'on';
  kind: TemporalFieldKind;
  filter: FilterCondition;
  /** Ids of matching rows, ascending. */
  expected: string[];
  /** Why the case is here — surfaced in failure output. */
  note?: string;
}

/**
 * The cases, ordered from the rule outward: the whole-day upper bound that
 * #3777 was about, then the operators that must NOT move, then the comparand
 * shapes that must not be widened, then the rollovers.
 */
export const TEMPORAL_CASES: readonly TemporalCase[] = [
  // ── The rule: a bare-day UPPER bound denotes the whole day (D-D) ──────────
  {
    name: 'datetime: bare-day $lte keeps the whole final day',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    expected: ['b_prev', 'c_open', 'd_mid', 'e_late'],
    note: '#3777: the default dashboard window. Pre-fix returned only b_prev + c_open — everything after 00:00 on the final day vanished.',
  },
  {
    name: 'date: the same window is unchanged (already whole-day)',
    field: 'on',
    kind: 'date',
    filter: { on: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    expected: ['b_prev', 'c_open', 'd_mid', 'e_late'],
    note: 'A `date` column compares as calendar-day text, so `<= day` was always right there. The two rows must agree — that is the invariant.',
  },
  {
    name: 'datetime: a bare-day $lte alone stops at the next midnight',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $lte: '2026-07-28' } },
    expected: ['a_old', 'b_prev', 'c_open', 'd_mid', 'e_late', 'h_leap'],
    note: 'f_next sits exactly on the exclusive edge and must stay out — a half-open bound, never an inclusive 23:59:59.999.',
  },
  {
    name: 'datetime: $between inherits the rule on its max',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $between: ['2026-04-29', '2026-07-28'] } },
    expected: ['b_prev', 'c_open', 'd_mid', 'e_late'],
    note: 'knex whereBetween is inclusive on both ends, so it had the same midnight-anchored upper bound $lte had.',
  },
  {
    name: 'datetime: $between still bounds its min',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $between: ['2026-07-28', '2026-07-28'] } },
    expected: ['c_open', 'd_mid', 'e_late'],
    note: 'The "today" preset degenerates to a single day: the min stays midnight-anchored while the max spans the day.',
  },

  // ── Operators that must NOT move (the correct-as-written column) ──────────
  {
    name: 'datetime: bare-day $gte is that midnight',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $gte: '2026-07-28' } },
    expected: ['c_open', 'd_mid', 'e_late', 'f_next', 'g_eom'],
    note: 'A LOWER bound anchors to 00:00 — c_open is included precisely because the bound is inclusive of that instant.',
  },
  {
    name: 'datetime: bare-day $lt is that midnight',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $lt: '2026-07-28' } },
    expected: ['a_old', 'b_prev', 'h_leap'],
    note: 'Strict-less keeps its anchoring: c_open is AT midnight, so it is excluded.',
  },
  {
    // `$gt` is asserted on the `date` column only — see "One cell is not
    // shared" in the module doc for why the `datetime` cell cannot be.
    name: 'date: bare-day $gt excludes the bound day',
    field: 'on',
    kind: 'date',
    filter: { on: { $gt: '2026-07-28' } },
    expected: ['f_next', 'g_eom'],
    note: 'The boundary day itself is out; the mirror-image of widening a lower bound.',
  },

  // ── Comparand shapes that must not be widened ─────────────────────────────
  {
    name: 'datetime: a full-ISO $lte keeps exact-instant semantics',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $lte: '2026-07-28T12:00:00.000Z' } },
    expected: ['a_old', 'b_prev', 'c_open', 'd_mid', 'h_leap'],
    note: 'Only the day-granular STRING carries whole-day intent. e_late (21:40) is after noon and must stay out.',
  },
  {
    name: 'datetime: a full-ISO $gte is exact too',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $gte: '2026-07-28T09:15:00.000Z' } },
    expected: ['d_mid', 'e_late', 'f_next', 'g_eom'],
    note: 'd_mid is exactly the bound and inclusive.',
  },

  // ── Rollovers: the arithmetic has to be a calendar, not +86400000 ─────────
  {
    name: 'datetime: month-end $lte spans to the next month',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $gte: '2026-07-29', $lte: '2026-07-31' } },
    expected: ['f_next', 'g_eom'],
    note: 'g_eom is 23:59:59.999 on the 31st — kept only if the bound rolled to 2026-08-01.',
  },
  {
    name: 'datetime: leap-day $lte includes Feb 29',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $gte: '2024-02-01', $lte: '2024-02-29' } },
    expected: ['h_leap'],
    note: 'The next day is 2024-03-01; a naive month-increment would produce 2024-02-30.',
  },
  {
    name: 'datetime: the day BEFORE the leap day excludes it',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $gte: '2024-02-01', $lte: '2024-02-28' } },
    expected: [],
    note: 'Guards the opposite error: rolling 02-28 to 03-01 (skipping the 29th) would wrongly include h_leap.',
  },
] as const;
