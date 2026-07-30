// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for **temporal filter semantics** — the single
 * source of truth every evaluation surface that compares a `date`/`datetime`
 * comparand against stored rows is checked against (ADR-0053 D-A3).
 *
 * ## Why this exists
 *
 * The temporal seam broke four times, and each break was found by accident,
 * not by a test:
 *
 * | Issue | Symptom | Fix |
 * |---|---|---|
 * | #3650 | analytics dropped a date window entirely → charted all history | PR #3766 |
 * | #3773 | SQLite datetime bucketing read epoch ms as Julian days → NULL buckets | PR #3775 |
 * | #3777 | bare-day upper bound anchored to midnight → lost the final day (default dashboard config) | PR #4041 / #4048 |
 * | #4047 | memory/mongo compared string comparands against `Date` values by type → windows returned nothing | PR #4060 |
 *
 * Each fix left behind its own suite proving its own issue, with its own
 * fixture. Nothing held the six evaluation surfaces to ONE standard, so the
 * fifth divergence would again be invisible until a user hit it. This table is
 * that standard — the temporal twin of {@link FILTER_LOGIC_CASES} (#3774),
 * consumed the same way: each backend has a thin test that seeds
 * {@link TEMPORAL_CONFORMANCE_ROWS} through its own write path and asserts the
 * row-id sets in {@link TemporalConformanceCase.expected}. **Row results, not
 * emitted SQL** — the ADR's hard requirement.
 *
 * | Backend | Where |
 * |---|---|
 * | SQL compiler (SQLite; live PG + MySQL in CI's temporal job) | `driver-sql` |
 * | SQLite-wasm (inherits the SQL compiler) | `driver-sqlite-wasm` |
 * | In-memory matcher | `driver-memory` |
 * | MongoDB (real server via mongodb-memory-server) | `driver-mongodb` |
 * | Record-at-a-time evaluator (RLS write-side `check`) | `formula` `matchesFilterCondition` |
 * | Dataset draft preview | `service-analytics` `preview-evaluator` |
 *
 * ## The axes (D-A3, extended by D-D2 and D-E4)
 *
 * - **field-type**: {@link TemporalConformanceCase.fieldType} — `date`
 *   (tz-naive calendar day) vs `datetime` (UTC instant).
 * - **operator**: eq, gte/gt/lt/lte windows, in, between, and the analytics
 *   `timeDimensions.dateRange` spelling ({@link TemporalConformanceCase.dateRange}).
 * - **bound-semantics** (D-D2): point vs whole-day — a bare `YYYY-MM-DD`
 *   upper bound means the WHOLE day (compiled half-open, `< next-day`), while
 *   lower/strict bounds and full-ISO comparands anchor to the instant.
 * - **relative-token**: {@link TemporalConformanceCase.tokenFilter} spells the
 *   same filter with `{today}` / `{90_days_ago}` / period tokens. Consumers
 *   resolve it via `@objectstack/core`'s `resolveFilterTokens` pinned to
 *   {@link TEMPORAL_CONFORMANCE_NOW} and must get the same ids — so a resolver
 *   drift and an evaluator drift are distinguishable at a glance.
 * - **storage-form** (D-E4): {@link TemporalConformanceRow.writerForm} tags
 *   each row with a writer shape (`wire` ISO string vs `native` JS `Date`), so
 *   the drivers whose columns were mixed-form (#4047) seed a genuinely mixed
 *   table. `driver-sql` additionally re-runs the table over legacy epoch/naive
 *   storage via its `LegacyStorageDriver` testkit (#3912).
 * - **driver**: every backend above. The SQL consumer also runs under CI's
 *   `Temporal Conformance (live PG + MySQL)` job (`ci.yml`), which supplies
 *   the non-UTC server-timezone axis for free.
 *
 * ## Deliberate scope — a case belongs here only if EVERY backend must agree
 *
 * Two consumers (`matchesFilterCondition`, the preview's `matchesWhere`)
 * evaluate a bare record with **no schema**: they cannot canonicalise a
 * comparand to a column's storage form, only compare canonical text
 * lexicographically (which ISO-8601 makes chronological). Three cells are
 * therefore *schema-aware-only* and deliberately absent:
 *
 * - `$eq` / `$in` with a bare day on a `datetime` column (means "the midnight
 *   instant" to a driver, plain string inequality to a schema-blind matcher);
 * - `$gt` where a stored instant sits exactly AT the bound's midnight (the
 *   driver excludes it; lexicographic text compare includes it);
 * - `Field.time` (D-C) — its own convention, its own suites.
 *
 * Those cells stay pinned where they always were — the per-driver suites
 * (`sql-driver-calendar-day-upper-bound.test.ts` and kin). Every case below
 * either avoids the ambiguous shape (no fixture row at a `$gt` bound's
 * midnight) or targets a `date` column, where text equality IS the contract.
 */

import type { FilterCondition } from './filter.zod';

/**
 * The pinned reference instant for resolving {@link TemporalConformanceCase.tokenFilter}
 * and {@link TemporalConformanceCase.dateRange}: consumers pass
 * `{ now: new Date(TEMPORAL_CONFORMANCE_NOW) }` (UTC, no timezone) to
 * `resolveFilterTokens`. Mid-day, so no token resolution sits on a day
 * boundary; `{today}` = `2026-07-28`, matching the #3777/#4047 incident
 * fixtures.
 */
export const TEMPORAL_CONFORMANCE_NOW = '2026-07-28T12:00:00.000Z';

/**
 * Which write-path shape a consumer should seed the row through, where the
 * distinction exists (D-E4 `mixed-writer-form`): `wire` = the ISO-8601 string
 * a REST/JSON write delivers; `native` = a JS `Date`, what SDK callers and the
 * drivers' own timestamp defaults produce. Both must converge to one stored
 * form — the columns that held both at once are how #4047 happened.
 */
export type TemporalWriterForm = 'wire' | 'native';

/** A row in the conformance fixture. */
export interface TemporalConformanceRow {
  id: string;
  /** Canonical UTC instant, `YYYY-MM-DDTHH:MM:SS.sssZ` (D-B1). */
  happened_at: string;
  /** The instant's UTC calendar day — the row's `Field.date` value. */
  happened_on: string;
  /** Writer shape for the mixed-writer-form axis — see {@link TemporalWriterForm}. */
  writerForm: TemporalWriterForm;
}

/**
 * The fixture, chronological. Every boundary the four incidents turned on
 * appears as a row: a pre-epoch instant (negative epoch ms), a leap day, the
 * last millisecond of a month abutting the next month's first instant, a
 * window edge, and a full day of instants (its exact midnight, two intra-day
 * times, and the NEXT day's midnight — the row a whole-day upper bound must
 * exclude). Writer forms alternate so both shapes appear inside and outside
 * every window.
 */
export const TEMPORAL_CONFORMANCE_ROWS: readonly TemporalConformanceRow[] = [
  { id: 'pre_epoch', happened_at: '1969-12-31T23:00:00.000Z', happened_on: '1969-12-31', writerForm: 'wire' },
  { id: 'leap', happened_at: '2024-02-29T12:00:00.000Z', happened_on: '2024-02-29', writerForm: 'native' },
  { id: 'window_out', happened_at: '2026-04-19T10:00:00.000Z', happened_on: '2026-04-19', writerForm: 'wire' },
  { id: 'month_end', happened_at: '2026-06-30T23:59:59.999Z', happened_on: '2026-06-30', writerForm: 'wire' },
  { id: 'month_start', happened_at: '2026-07-01T00:00:00.000Z', happened_on: '2026-07-01', writerForm: 'native' },
  { id: 'week_edge', happened_at: '2026-07-21T08:30:00.000Z', happened_on: '2026-07-21', writerForm: 'wire' },
  { id: 'yesterday', happened_at: '2026-07-27T14:00:00.000Z', happened_on: '2026-07-27', writerForm: 'native' },
  { id: 'midnight', happened_at: '2026-07-28T00:00:00.000Z', happened_on: '2026-07-28', writerForm: 'native' },
  { id: 'morning', happened_at: '2026-07-28T09:15:00.000Z', happened_on: '2026-07-28', writerForm: 'wire' },
  { id: 'evening', happened_at: '2026-07-28T21:40:00.000Z', happened_on: '2026-07-28', writerForm: 'wire' },
  { id: 'next_midnight', happened_at: '2026-07-29T00:00:00.000Z', happened_on: '2026-07-29', writerForm: 'native' },
] as const;

/** One conformance case: a temporal filter and the row ids it must match. */
export interface TemporalConformanceCase {
  /** Stable identifier, usable as a test name. */
  name: string;
  /** Which fixture column the filter targets: `happened_at` or `happened_on`. */
  fieldType: 'date' | 'datetime';
  /**
   * Operator-axis family. `between` exists so the one consumer whose DSL
   * subset has no `$between` (the analytics preview `where`) can skip those
   * cases visibly instead of evaluating them permissively.
   */
  operator: 'eq' | 'in' | 'range' | 'between';
  /** The filter with literal comparands — ground truth for all six backends. */
  filter: FilterCondition;
  /**
   * The same filter spelled with relative-date tokens. Consumers that can
   * reach `@objectstack/core` resolve it against {@link TEMPORAL_CONFORMANCE_NOW}
   * and assert the same {@link expected} — end-to-end "token → row results".
   */
  tokenFilter?: FilterCondition;
  /**
   * The analytics `timeDimensions.dateRange` spelling of the same window
   * (tokens allowed), for the preview/dataset path — the surface #3650 broke.
   */
  dateRange?: [string, string];
  /** Ids of matching rows, ascending (plain ASCII sort). */
  expected: string[];
  /** Why the case is here — surfaced in failure output. */
  note?: string;
}

/**
 * The cases. Ordered: whole-day upper bounds (the #3777 family), then
 * calendar-boundary rollovers, then point-semantics anchors, then the `date`
 * column half of the contract.
 */
export const TEMPORAL_CONFORMANCE_CASES: readonly TemporalConformanceCase[] = [
  // ── Whole-day upper bounds (bound-semantics: whole-day) ───────────────────
  {
    name: 'a 90-day dashboard window keeps the whole final day',
    fieldType: 'datetime',
    operator: 'range',
    filter: { happened_at: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    tokenFilter: { happened_at: { $gte: '{90_days_ago}', $lte: '{today}' } },
    dateRange: ['{90_days_ago}', '{today}'],
    expected: ['evening', 'midnight', 'month_end', 'month_start', 'morning', 'week_edge', 'yesterday'],
    note: '#3777: the midnight-anchored $lte dropped morning+evening; #4047: on mongo the whole window returned []. The dashboard default config (created_at × last_90_days) compiles exactly this.',
  },
  {
    name: 'the today preset spans the whole current day',
    fieldType: 'datetime',
    operator: 'range',
    filter: { happened_at: { $gte: '2026-07-28', $lte: '2026-07-28' } },
    tokenFilter: { happened_at: { $gte: '{today}', $lte: '{today}' } },
    dateRange: ['{today}', '{today}'],
    expected: ['evening', 'midnight', 'morning'],
    note: '#3777: 7 of the 13 dashboard presets end "today"; pre-fix a same-day window matched only the exact-midnight row. next_midnight must stay out — half-open, not next-day-inclusive.',
  },
  {
    name: '$between with a bare-day max covers the whole final day',
    fieldType: 'datetime',
    operator: 'between',
    filter: { happened_at: { $between: ['2026-04-29', '2026-07-28'] } },
    tokenFilter: { happened_at: { $between: ['{90_days_ago}', '{today}'] } },
    expected: ['evening', 'midnight', 'month_end', 'month_start', 'morning', 'week_edge', 'yesterday'],
    note: '#4042: $between decomposes to `>= min AND < next-day(max)`; must answer identically to the $gte/$lte spelling.',
  },
  {
    name: 'a full-ISO upper bound keeps instant semantics',
    fieldType: 'datetime',
    operator: 'range',
    filter: { happened_at: { $lte: '2026-07-28T12:00:00.000Z' } },
    expected: ['leap', 'midnight', 'month_end', 'month_start', 'morning', 'pre_epoch', 'week_edge', 'window_out', 'yesterday'],
    note: 'D-D2 bound-semantics: only a BARE day widens to the whole day. An instant comparand is a point — evening (21:40) must stay out.',
  },

  // ── Calendar-boundary rollovers ───────────────────────────────────────────
  {
    name: 'the last millisecond of a month survives its whole-day upper bound',
    fieldType: 'datetime',
    operator: 'range',
    filter: { happened_at: { $gte: '2026-06-01', $lte: '2026-06-30' } },
    tokenFilter: { happened_at: { $gte: '{last_month_start}', $lte: '{last_month_end}' } },
    dateRange: ['{last_month_start}', '{last_month_end}'],
    expected: ['month_end'],
    note: 'month_end sits at 23:59:59.999 and month_start at the NEXT instant: the bound must roll to `< 2026-07-01`, keeping the one and excluding the other. An inclusive 23:59:59.999 rewrite passes on ms-precision stores but re-opens the gap wherever sub-ms precision exists (Postgres keeps µs) — half-open is the pinned shape.',
  },
  {
    name: 'a leap-day window rolls to March 1',
    fieldType: 'datetime',
    operator: 'range',
    filter: { happened_at: { $gte: '2024-02-29', $lte: '2024-02-29' } },
    expected: ['leap'],
    note: 'nextUtcCalendarDay(2024-02-29) is 2024-03-01; day-string arithmetic that invents 2024-02-30 matches nothing.',
  },
  {
    name: 'a pre-epoch day is an ordinary calendar day',
    fieldType: 'datetime',
    operator: 'range',
    filter: { happened_at: { $gte: '1969-12-31', $lte: '1969-12-31' } },
    expected: ['pre_epoch'],
    note: 'Negative epoch ms. The #3773 family: any surface that assumes a datetime is a non-negative epoch (or a Julian day) breaks here first.',
  },

  // ── Point-semantics anchors (bound-semantics: point) ──────────────────────
  {
    name: '$lt of a bare day stops at that midnight',
    fieldType: 'datetime',
    operator: 'range',
    filter: { happened_at: { $lt: '2026-07-28' } },
    tokenFilter: { happened_at: { $lt: '{today}' } },
    expected: ['leap', 'month_end', 'month_start', 'pre_epoch', 'week_edge', 'window_out', 'yesterday'],
    note: 'D-D1: lower/strict bounds anchor to 00:00. The exact-midnight row is NOT before its own day.',
  },
  {
    name: '$gte of a bare day starts at that midnight, inclusive',
    fieldType: 'datetime',
    operator: 'range',
    filter: { happened_at: { $gte: '2026-07-28' } },
    tokenFilter: { happened_at: { $gte: '{today}' } },
    expected: ['evening', 'midnight', 'morning', 'next_midnight'],
    note: '#4047: on mongo a string bound matched no Date row at all, for every operator — $gte included.',
  },
  {
    name: '$gt of a bare day is midnight-anchored',
    fieldType: 'datetime',
    operator: 'range',
    filter: { happened_at: { $gt: '2026-07-27' } },
    tokenFilter: { happened_at: { $gt: '{yesterday}' } },
    expected: ['evening', 'midnight', 'morning', 'next_midnight', 'yesterday'],
    note: 'Deliberate scope: no fixture row sits exactly AT this bound\'s midnight — whether $gt excludes that instant is a schema-aware cell, pinned in sql-driver-calendar-day-upper-bound.test.ts.',
  },

  // ── The `date` column half of the contract ────────────────────────────────
  {
    name: 'date equality against a resolved {today}',
    fieldType: 'date',
    operator: 'eq',
    filter: { happened_on: '2026-07-28' },
    tokenFilter: { happened_on: '{today}' },
    expected: ['evening', 'midnight', 'morning'],
    note: "The ADR's original defect (#1874): `date == today` silently matched nothing while dates were stored as instants. Equality on a date column is plain text equality — Phase 1's whole point.",
  },
  {
    name: 'date $in of two resolved days',
    fieldType: 'date',
    operator: 'in',
    filter: { happened_on: { $in: ['2026-07-28', '2026-07-27'] } },
    tokenFilter: { happened_on: { $in: ['{today}', '{yesterday}'] } },
    expected: ['evening', 'midnight', 'morning', 'yesterday'],
    note: 'The `expires_on: { $in: [daysFromNow(30)] }` template shape from the #1874 family.',
  },
  {
    name: 'the 90-day window answers identically on date and datetime',
    fieldType: 'date',
    operator: 'range',
    filter: { happened_on: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    tokenFilter: { happened_on: { $gte: '{90_days_ago}', $lte: '{today}' } },
    dateRange: ['{90_days_ago}', '{today}'],
    expected: ['evening', 'midnight', 'month_end', 'month_start', 'morning', 'week_edge', 'yesterday'],
    note: 'Same ids as the datetime case by construction: whole-day window semantics are field-type-independent. A backend that widens or narrows only one of the two field types fails exactly one of the pair.',
  },
  {
    name: 'a date column $lte the last day of a month keeps that day',
    fieldType: 'date',
    operator: 'range',
    filter: { happened_on: { $lte: '2026-06-30' } },
    tokenFilter: { happened_on: { $lte: '{last_month_end}' } },
    expected: ['leap', 'month_end', 'pre_epoch', 'window_out'],
    note: 'On date text `< next-day` is order-equivalent to `<= day` (D-D1) — what lets type-blind emitters rewrite unconditionally. Also the write-side twin: a `check` policy `{ $lte: \'{today}\' }` must not deny same-day rows.',
  },
  {
    name: 'a month window via period tokens',
    fieldType: 'datetime',
    operator: 'range',
    filter: { happened_at: { $gte: '2026-07-01', $lte: '2026-07-31' } },
    tokenFilter: { happened_at: { $gte: '{current_month_start}', $lte: '{current_month_end}' } },
    dateRange: ['{current_month_start}', '{current_month_end}'],
    expected: ['evening', 'midnight', 'month_start', 'morning', 'next_midnight', 'week_edge', 'yesterday'],
    note: "{current_month_end} names the last calendar DAY (2026-07-31), per the vocabulary's documented refusal to widen; the whole-day bound rule is what makes its $lte include the 31st's instants. The two halves of the contract composing (filter-tokens.ts module doc × D-D1).",
  },
] as const;
