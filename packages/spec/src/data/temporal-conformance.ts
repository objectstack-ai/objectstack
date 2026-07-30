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
 *
 * # The relative-token axis (D-A3's "token → row results", #4081)
 *
 * The four incidents happened below token resolution, but the tokens are how
 * authors actually WRITE these filters — `{today}`, `{90_days_ago}`,
 * `{current_month_end}` — and nothing proved the resolved comparand reaches
 * the same rows on every backend. So a case may carry
 * {@link TemporalCase.tokenFilter} (and, for the analytics window path,
 * {@link TemporalCase.dateRange}): the SAME filter spelled in tokens.
 * Consumers that can reach `@objectstack/core` resolve it via
 * `resolveFilterTokens` pinned to {@link TEMPORAL_NOW} and must land on the
 * same {@link TemporalCase.expected} as the literal spelling — so a resolver
 * drift and an evaluator drift are distinguishable at a glance. `formula`
 * deliberately depends on nothing but `spec` and skips the token sweep: by the
 * time a filter reaches it, tokens are already resolved.
 *
 * # The writer-form seeding hint (D-E4 `mixed-writer-form`)
 *
 * Storage form stays out of scope here (see "What belongs here"), but HOW a
 * row is written is exactly how #4047 happened: the drivers' mixed columns
 * were produced by two writer populations (REST/JSON ISO strings vs SDK
 * `Date`s). {@link TemporalRow.writerForm} tags each row so a driver consumer
 * can seed a genuinely mixed writer population through its own `create()` —
 * the assertion stays "which rows match", the convergence itself remains each
 * driver's own suite's claim.
 *
 * # The storage-form axis (D-B3/D-E3 → the D-A3 legacy sweep, #4191)
 *
 * Seeding through `create()` proves "what I write I can read back" — but two
 * of the four incidents were about reading forms the CURRENT write path never
 * produces: rows written before the convention existed and never backfilled
 * (D-B3 allows the backfill to fail; D-E3 gives MongoDB no automatic backfill
 * at all, so its legacy data is PERMANENT, not transitional). A consumer with
 * a read-repair or convergence path therefore runs the same cases a SECOND
 * time against rows injected BELOW its write path, in the raw forms the
 * pre-convention writers left behind.
 *
 * The {@link TemporalWriterForm} tag is the per-row seeding basis for that
 * sweep too — the same two populations, just left UNconverged:
 *
 * - `native` → the platform-native instant bound raw, in whatever shape the
 *   store kept it (INTEGER epoch ms on SQLite, a BSON `Date` on mongo, a JS
 *   `Date` in memory). For a {@link TemporalTimeRow} the instant is the epoch
 *   day's — `1970-01-01T${at}Z` — so `a_midnight` lands as the measured
 *   #3994 hazard: INTEGER `0`, which sorts before every TEXT row.
 * - `wire` → raw text the write path did not rewrite: for `datetime` the
 *   zone-naive `YYYY-MM-DD HH:MM:SS` a `CURRENT_TIMESTAMP` default emitted;
 *   for `time` a full-timestamp spelling that still carries a calendar day —
 *   pin it to the fixture's boundary day (`2026-07-28T${at}Z`) so every
 *   consumer seeds the same bytes.
 *
 * The physical spelling is each driver's own suite's business (that is why no
 * per-dialect values live here); what is shared is the acceptance rule: the
 * legacy sweep must land on the same {@link TemporalCase.expected} row-id
 * sets, cell for cell, as the canonical sweep. Any cell that differs means
 * that backend's repair path has drifted from the consensus — the signal
 * #3773 / #3994 / #4047 all lacked.
 */

import type { FilterCondition } from './filter.zod';

/**
 * The pinned reference instant for resolving {@link TemporalCase.tokenFilter}
 * and {@link TemporalCase.dateRange}: consumers pass
 * `{ now: new Date(TEMPORAL_NOW) }` (UTC, no timezone) to
 * `resolveFilterTokens`. Mid-day, so no token resolution sits on a day
 * boundary; `{today}` resolves to the fixture's boundary day `2026-07-28`,
 * `{90_days_ago}` to `2026-04-29`, `{yesterday}` to `2026-07-27`.
 */
export const TEMPORAL_NOW = '2026-07-28T12:00:00.000Z';

/**
 * Which write-path shape a driver consumer should seed the row through, where
 * the distinction exists (D-E4): `wire` = the ISO-8601 string a REST/JSON
 * write delivers; `native` = a JS `Date`, what SDK callers and the drivers'
 * own timestamp defaults produce. Both writer populations appear inside AND
 * outside every window, so a backend that converges only one form fails.
 *
 * The same tag doubles as the seeding basis for the storage-form axis (see
 * "The storage-form axis" in the module doc): a legacy sweep injects the
 * SAME populations below the write path, unconverged — `native` as the raw
 * platform-native instant, `wire` as the raw text spelling — and must reach
 * the same expected row-id sets.
 */
export type TemporalWriterForm = 'wire' | 'native';

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
  /** Writer-population seeding hint for drivers — see {@link TemporalWriterForm}. */
  writerForm: TemporalWriterForm;
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
  { id: 'a_epoch', at: '1969-12-31T23:00:00.000Z', on: '1969-12-31', writerForm: 'wire',   why: 'pre-epoch instant (negative epoch ms) — any surface assuming a non-negative epoch, or reading one as a Julian day (#3773), breaks here first' },
  { id: 'a_old',   at: '2026-04-19T10:00:00.000Z', on: '2026-04-19', writerForm: 'wire',   why: 'well before any window here' },
  { id: 'b_prev',  at: '2026-07-27T14:00:00.000Z', on: '2026-07-27', writerForm: 'native', why: 'the day before the boundary day' },
  { id: 'c_open',  at: '2026-07-28T00:00:00.000Z', on: '2026-07-28', writerForm: 'native', why: 'boundary day at exactly 00:00 — the only instant a midnight-anchored bound keeps' },
  { id: 'd_mid',   at: '2026-07-28T09:15:00.000Z', on: '2026-07-28', writerForm: 'wire',   why: 'boundary day, morning — dropped by the #3777 bug' },
  { id: 'e_late',  at: '2026-07-28T21:40:00.000Z', on: '2026-07-28', writerForm: 'wire',   why: 'boundary day, evening — dropped by the #3777 bug' },
  { id: 'f_next',  at: '2026-07-29T00:00:00.000Z', on: '2026-07-29', writerForm: 'native', why: 'next midnight — the exclusive edge a half-open bound must NOT keep' },
  { id: 'g_eom',   at: '2026-07-31T23:59:59.999Z', on: '2026-07-31', writerForm: 'wire',   why: 'last representable instant of a month — month rollover' },
  { id: 'h_leap',  at: '2024-02-29T12:00:00.000Z', on: '2024-02-29', writerForm: 'native', why: 'leap day — February rollover' },
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
  /**
   * The same filter spelled with relative-date tokens — see "The
   * relative-token axis" in the module doc. Resolve against
   * {@link TEMPORAL_NOW}; the resolved filter must reach {@link expected}.
   */
  tokenFilter?: FilterCondition;
  /**
   * The analytics `timeDimensions.dateRange` spelling of the same window
   * (tokens allowed) for the dashboard-window path — the surface #3650 broke.
   */
  dateRange?: [string, string];
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
    tokenFilter: { at: { $gte: '{90_days_ago}', $lte: '{today}' } },
    dateRange: ['{90_days_ago}', '{today}'],
    expected: ['b_prev', 'c_open', 'd_mid', 'e_late'],
    note: '#3777: the default dashboard window. Pre-fix returned only b_prev + c_open — everything after 00:00 on the final day vanished.',
  },
  {
    name: 'date: the same window is unchanged (already whole-day)',
    field: 'on',
    kind: 'date',
    filter: { on: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    tokenFilter: { on: { $gte: '{90_days_ago}', $lte: '{today}' } },
    dateRange: ['{90_days_ago}', '{today}'],
    expected: ['b_prev', 'c_open', 'd_mid', 'e_late'],
    note: 'A `date` column compares as calendar-day text, so `<= day` was always right there. The two rows must agree — that is the invariant.',
  },
  {
    name: 'datetime: a bare-day $lte alone stops at the next midnight',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $lte: '2026-07-28' } },
    tokenFilter: { at: { $lte: '{today}' } },
    expected: ['a_epoch', 'a_old', 'b_prev', 'c_open', 'd_mid', 'e_late', 'h_leap'],
    note: 'f_next sits exactly on the exclusive edge and must stay out — a half-open bound, never an inclusive 23:59:59.999.',
  },
  {
    name: 'datetime: $between inherits the rule on its max',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $between: ['2026-04-29', '2026-07-28'] } },
    tokenFilter: { at: { $between: ['{90_days_ago}', '{today}'] } },
    expected: ['b_prev', 'c_open', 'd_mid', 'e_late'],
    note: 'knex whereBetween is inclusive on both ends, so it had the same midnight-anchored upper bound $lte had.',
  },
  {
    name: 'datetime: $between still bounds its min',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $between: ['2026-07-28', '2026-07-28'] } },
    tokenFilter: { at: { $between: ['{today}', '{today}'] } },
    dateRange: ['{today}', '{today}'],
    expected: ['c_open', 'd_mid', 'e_late'],
    note: 'The "today" preset degenerates to a single day: the min stays midnight-anchored while the max spans the day.',
  },

  // ── Operators that must NOT move (the correct-as-written column) ──────────
  {
    name: 'datetime: bare-day $gte is that midnight',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $gte: '2026-07-28' } },
    tokenFilter: { at: { $gte: '{today}' } },
    expected: ['c_open', 'd_mid', 'e_late', 'f_next', 'g_eom'],
    note: 'A LOWER bound anchors to 00:00 — c_open is included precisely because the bound is inclusive of that instant.',
  },
  {
    name: 'datetime: bare-day $lt is that midnight',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $lt: '2026-07-28' } },
    tokenFilter: { at: { $lt: '{today}' } },
    expected: ['a_epoch', 'a_old', 'b_prev', 'h_leap'],
    note: 'Strict-less keeps its anchoring: c_open is AT midnight, so it is excluded.',
  },
  {
    // `$gt` is asserted on the `date` column only — see "One cell is not
    // shared" in the module doc for why the `datetime` cell cannot be.
    name: 'date: bare-day $gt excludes the bound day',
    field: 'on',
    kind: 'date',
    filter: { on: { $gt: '2026-07-28' } },
    tokenFilter: { on: { $gt: '{today}' } },
    expected: ['f_next', 'g_eom'],
    note: 'The boundary day itself is out; the mirror-image of widening a lower bound.',
  },

  // ── Comparand shapes that must not be widened ─────────────────────────────
  {
    name: 'datetime: a full-ISO $lte keeps exact-instant semantics',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $lte: '2026-07-28T12:00:00.000Z' } },
    expected: ['a_epoch', 'a_old', 'b_prev', 'c_open', 'd_mid', 'h_leap'],
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
    tokenFilter: { at: { $gte: '{tomorrow}', $lte: '{current_month_end}' } },
    dateRange: ['{tomorrow}', '{current_month_end}'],
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
  {
    name: 'datetime: a pre-epoch day is an ordinary calendar day',
    field: 'at',
    kind: 'datetime',
    filter: { at: { $gte: '1969-12-31', $lte: '1969-12-31' } },
    expected: ['a_epoch'],
    note: 'Negative epoch ms. The #3773 family: any surface that assumes a datetime is a non-negative epoch, or reads one as a Julian day, breaks here first.',
  },

  // ── Equality on the `date` column — the ADR's original defect (#1874) ────
  {
    name: 'date: equality against a resolved day matches the whole day',
    field: 'on',
    kind: 'date',
    filter: { on: '2026-07-28' },
    tokenFilter: { on: '{today}' },
    expected: ['c_open', 'd_mid', 'e_late'],
    note: '#1874: `date == today` silently matched nothing while dates were stored as instants. Equality on a date column is plain calendar-day text equality — Phase 1\'s whole point.',
  },
  {
    name: 'date: $in of two resolved days',
    field: 'on',
    kind: 'date',
    filter: { on: { $in: ['2026-07-28', '2026-07-27'] } },
    tokenFilter: { on: { $in: ['{today}', '{yesterday}'] } },
    expected: ['b_prev', 'c_open', 'd_mid', 'e_late'],
    note: 'The `expires_on: { $in: [daysFromNow(30)] }` template shape from the #1874 family — element-wise, order-independent.',
  },
] as const;

// ── `Field.time` — the third temporal type, its own axis ─────────────────────

/**
 * A row in the time-of-day fixture.
 *
 * `at` is a `Field.time`: a timezone-naive WALL CLOCK (#2004), not an instant
 * and not a calendar day. The canonical form is `HH:MM:SS`, extended to
 * `HH:MM:SS.fff` exactly when the milliseconds are non-zero (ADR-0053 D-C1) —
 * variable width on purpose, because `.` sorts below every digit, so
 * lexicographic order stays chronological order across the two widths.
 */
export interface TemporalTimeRow {
  id: string;
  /** `Field.time` — canonical wall-clock text. */
  at: string;
  /**
   * Writer-population seeding hint — the D-E4 axis, one field type over. See
   * {@link TemporalWriterForm}. `native` means a driver consumer writes the
   * row as a JS `Date` whose UTC time-of-day IS `at` (build it from
   * `1970-01-01T${at}Z`), which is what an SDK caller or a bound `NOW()`
   * produces; `wire` means the canonical text a REST/JSON write delivers.
   *
   * Seeding both is the point. A fixture written entirely in canonical text
   * passes even on a backend with NO time convention at all, because both
   * sides of every comparison happen to be the same string — so it would
   * assert nothing. The mixed column is what #3994 measured on SQL, and it is
   * the shape that must not survive on any other backend either.
   */
  writerForm: TemporalWriterForm;
  /** Why the row is in the fixture — surfaced when a case fails. */
  why: string;
}

/**
 * The fixture: a business day, chosen so the boundaries that broke #3994 are
 * each decidable. `c_open` and `f_close` sit exactly ON the window edges,
 * `d_mid`/`e_mid_ms` straddle the millisecond-suffix width change, and
 * `a_midnight`/`g_last` are the extremes of the 24-hour range.
 */
export const TEMPORAL_TIME_ROWS: readonly TemporalTimeRow[] = [
  { id: 'a_midnight', at: '00:00:00',     writerForm: 'native', why: 'the day\'s lower extreme, written as a Date — epoch 0 on SQLite, which sorts before every TEXT row' },
  { id: 'b_early',    at: '08:00:00',     writerForm: 'wire',   why: 'before opening — the row a business-hours lower bound must exclude' },
  { id: 'c_open',     at: '09:00:00',     writerForm: 'native', why: 'exactly the opening bound, which is inclusive' },
  { id: 'd_mid',      at: '14:30:00',     writerForm: 'wire',   why: 'mid-afternoon, zero milliseconds — the `HH:MM:SS` spelling every dialect\'s native TIME emits' },
  { id: 'e_mid_ms',   at: '14:30:00.500', writerForm: 'native', why: 'the same wall clock plus 500ms: the width change lexicographic order has to survive, and what MySQL bare TIME rounded away' },
  { id: 'f_close',    at: '18:00:00',     writerForm: 'wire',   why: 'exactly the closing bound, which is inclusive' },
  { id: 'g_last',     at: '23:59:59.999', writerForm: 'native', why: 'the day\'s upper extreme — the last representable wall clock' },
] as const;

/** One time conformance case: a filter on the wall-clock column. */
export interface TemporalTimeCase {
  /** Stable identifier, usable as a test name. */
  name: string;
  filter: FilterCondition;
  /** Ids of matching rows, ascending. */
  expected: string[];
  /** Why the case is here — surfaced in failure output. */
  note?: string;
}

/**
 * The cases.
 *
 * # Why `Field.time` needs its own table rather than a `kind` on the one above
 *
 * A wall clock shares no comparand vocabulary with the other two: no relative
 * token resolves to one (`{today}` is a calendar day), and the bare-day
 * whole-day rule (D-D) must NOT reach it — `nextUtcCalendarDay` only widens a
 * `YYYY-MM-DD` string, and a time never matches that shape. That last point is
 * asserted rather than assumed, because "the rule leaks into the wrong field
 * type" is precisely the class of bug this file exists to catch.
 *
 * # The scope rule is the same: only what EVERY backend must agree on
 *
 * One cell is deliberately absent. A minutes-only comparand (`{ at: '14:30' }`)
 * is canonicalised to `'14:30:00'` by a TYPED backend and compared as raw text
 * by a type-blind one, where `'14:30' !== '14:30:00'` — so it matches on the
 * drivers and misses in `formula`/the preview evaluator. It is the exact twin
 * of the `$gt`-on-`datetime` gap documented above, irreducible for the same
 * reason, and stays pinned in the typed drivers' own suites
 * (`sql-driver-time-of-day.test.ts`). Every case below uses a fully-spelled
 * canonical comparand, which both readings agree on.
 */
export const TEMPORAL_TIME_CASES: readonly TemporalTimeCase[] = [
  {
    name: 'time: a business-hours window keeps both bounds',
    filter: { at: { $gte: '09:00:00', $lte: '18:00:00' } },
    expected: ['c_open', 'd_mid', 'e_mid_ms', 'f_close'],
    note: '#3994, measured: 4 of 7 rows silently dropped. An epoch-ms row failed `>= 09:00:00` outright (INTEGER < TEXT on SQLite) and a full-timestamp row failed `<= 18:00:00` lexicographically.',
  },
  {
    name: 'time: an inclusive upper bound is EXACT, not widened',
    filter: { at: { $lte: '14:30:00' } },
    expected: ['a_midnight', 'b_early', 'c_open', 'd_mid'],
    note: 'The bare-day whole-day rule (D-D) must not reach a time column: `nextUtcCalendarDay` widens only a `YYYY-MM-DD` string. If it leaked, e_mid_ms (14:30:00.500) would appear.',
  },
  {
    name: 'time: the millisecond suffix sorts after its zero-ms twin',
    filter: { at: { $gt: '14:30:00' } },
    expected: ['e_mid_ms', 'f_close', 'g_last'],
    note: 'The variable-width canon (D-C1) only works because `.` sorts below every digit; d_mid is excluded by strict-greater and e_mid_ms is kept.',
  },
  {
    name: 'time: a sub-second window bounds the millisecond row',
    filter: { at: { $gte: '14:30:00.100', $lt: '14:30:01' } },
    expected: ['e_mid_ms'],
    note: 'Guards the same ordering from the other side — `14:30:00.500` must fall inside a window whose bounds differ only after the decimal point.',
  },
  {
    name: 'time: equality on a canonical wall clock',
    filter: { at: '14:30:00' },
    expected: ['d_mid'],
    note: 'Determinism is what equality and distinct() rest on: one wall clock has exactly one canonical spelling, so e_mid_ms is a DIFFERENT value, not a near-match.',
  },
  {
    name: 'time: $in of two canonical wall clocks',
    filter: { at: { $in: ['09:00:00', '18:00:00'] } },
    expected: ['c_open', 'f_close'],
  },
  {
    name: 'time: $between spans the working day inclusively',
    filter: { at: { $between: ['08:00:00', '18:00:00'] } },
    expected: ['b_early', 'c_open', 'd_mid', 'e_mid_ms', 'f_close'],
    note: 'Both ends inclusive, and — like the $lte case — NOT widened by the calendar-day rule.',
  },
  {
    name: 'time: midnight is an ordinary wall clock, not a null',
    filter: { at: { $lt: '09:00:00' } },
    expected: ['a_midnight', 'b_early'],
    note: 'A `00:00:00` write that became INTEGER 0 (a bound `Date` at UTC midnight) sorted before every TEXT row on SQLite and was reachable by no text bound at all.',
  },
  {
    name: 'time: the last wall clock of the day is reachable',
    filter: { at: { $gte: '23:59:59' } },
    expected: ['g_last'],
    note: 'The upper extreme, where an implementation that truncates or rounds the millisecond suffix (MySQL bare TIME did) loses the row.',
  },
] as const;
