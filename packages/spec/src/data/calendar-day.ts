// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Calendar-day bound semantics — what a bare `YYYY-MM-DD` MEANS on each side of
 * a comparison (ADR-0053 D-D, #3777).
 *
 * This lives beside `date-macros.zod.ts` because it is the semantic companion of
 * that vocabulary: the macros define which bare days an author can *name*
 * (`{today}`, `{current_month_end}`, …), and this defines what such a day
 * *denotes* when it lands on one side of a filter operator. Both halves are
 * protocol, so both belong to the one contract every producer and consumer
 * shares — the alternative is each backend re-deriving the rule, which is how
 * the four divergent implementations #3777 catalogued came about.
 *
 * The rule, per field type and operator:
 *
 * | Operator | A bare `YYYY-MM-DD` on a `datetime` column means |
 * |---|---|
 * | `$gte` / `$gt` / `$lt` | that day's `00:00:00.000` — already correct as written |
 * | `$lte`, a `$between` max, a `dateRange` end | the WHOLE day → compile `< nextUtcCalendarDay(day)` |
 * | the same, on `9999-12-31` | the WHOLE day → compile NO upper bound ({@link UNBOUNDED_ABOVE}) |
 *
 * Half-open, never an inclusive `23:59:59.999`: the latter re-opens the gap at
 * whatever sub-millisecond precision a dialect keeps (Postgres stores
 * microseconds), and `[gte, lt)` is the shape the analytics drill ranges (#1752)
 * already emit. On a `date` column `< nextDay` is order-equivalent to
 * `<= day` under plain `YYYY-MM-DD` text ordering, which is what lets emitters
 * that cannot see the column type apply it unconditionally.
 *
 * The last row is the one day with no next day to stop before. The supported
 * years are 0001..9999 (the comparand and write doors refuse the rest), so
 * every supported value is at most the last millisecond of `9999-12-31`, and
 * the whole-day bound of that day bounds nothing: `$lte '9999-12-31'` holds for
 * every value there is, and a `$between` whose maximum is that day keeps only
 * its minimum. The day after it has no bare-day spelling: `'10000-01-01'` sorts
 * below `'2026-…'` as text, so a SQLite column compared against it answered no
 * rows, and `null` would compile the day's midnight and miss the rest of it.
 * So the helper answers {@link UNBOUNDED_ABOVE}, and each emitter compiles no
 * upper bound for it — for a lone `$lte`, "the value is not null", the one
 * condition the comparison it replaces carried beyond its bound.
 */

/**
 * The type of {@link UNBOUNDED_ABOVE}: a `symbol` carrying a STRUCTURAL brand.
 *
 * Structural, not `unique symbol`, and that is the point. A `unique symbol` is
 * nominal to the declaration that spells it, and this package ships the `./data`
 * entry's declarations twice (`dist/data/index.d.mts` under `import`,
 * `dist/data/index.d.ts` under `require`), each declaring its own copy. A
 * program that reaches the sentinel through both files saw two unrelated
 * `unique symbol`s: the comparison against the constant was refused as having
 * "no overlap" (TS2367), and the guard stopped narrowing (TS2339) — measured in
 * `@objectstack/dogfood`, whose program maps one workspace package to source and
 * the rest to built types. Two copies of this alias are one type wherever they meet, so the answer
 * of the helper from one file and the constant or guard from another agree.
 *
 * Still a `symbol`, so the last day stays a member every caller must handle:
 * TypeScript refuses it in a template literal (TS2731), in a relational
 * comparison (TS2469) and where a `string` is expected (TS2345). ⛔ Never widen
 * it into `string`: a string-typed sentinel compiles and sorts silently as a
 * bound — the defect this answer exists to end. The brand key names no property
 * the value really has; it only makes the type distinct from every other
 * `symbol`. Narrow it with {@link isUnboundedAbove} (or `typeof … === 'symbol'`):
 * because the type is not a unit type, `=== UNBOUNDED_ABOVE` compares, but does
 * not narrow.
 */
export type UnboundedAbove = symbol & { readonly __objectstackCalendarDayBound: 'unbounded-above' };

/**
 * The answer {@link nextUtcCalendarDay} gives for `9999-12-31`, the last day of
 * the supported years: that day's whole-day bound is past every supported
 * value, so an emitter compiles NO upper bound for it (see the module note).
 *
 * A symbol, so no caller can compile it as a bound by accident, and distinct
 * from `null` ("not a calendar day"); its type is {@link UnboundedAbove}.
 * Registered with `Symbol.for`, so every bundled copy of this module (the ESM
 * and CJS builds, the browser builds) answers the same VALUE, whichever one a
 * caller's import resolved to. The structural type is what makes the copies'
 * declarations one TYPE as well.
 */
export const UNBOUNDED_ABOVE = Symbol.for('objectstack.calendarDay.unboundedAbove') as UnboundedAbove;

/**
 * Is `value` {@link UNBOUNDED_ABOVE}? The guard every reader of
 * {@link nextUtcCalendarDay} shares: it narrows the answer to `string | null`
 * on its false branch in any program, whichever declaration file each import
 * resolved to — which `=== UNBOUNDED_ABOVE` cannot do (see {@link UnboundedAbove}).
 * An unregistered `Symbol('objectstack.calendarDay.unboundedAbove')` is not it.
 */
export function isUnboundedAbove(value: unknown): value is UnboundedAbove {
  return value === UNBOUNDED_ABOVE;
}

export function nextUtcCalendarDay(value: unknown): string | UnboundedAbove | null {
  if (typeof value !== 'string') return null;
  const day = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const start = utcMidnight(y, mo - 1, d);
  // Reject a shape-valid but impossible day: the construction rolls 2026-02-30
  // into March, so the round-trip is what proves the input was a real calendar
  // day — in every year the four digits spell, 0001..0099 included.
  if (fmtUtcDay(start) !== day) return null;
  const next = fmtUtcDay(utcMidnight(y, mo - 1, d + 1));
  // The one real day whose successor has no `YYYY-MM-DD` spelling is
  // 9999-12-31: `fmtUtcDay` pads a year to four digits and never truncates, so
  // it spells the day after as the five-digit `'10000-01-01'`. The shape ends
  // where the supported years end (the doors refuse a year above 9999 —
  // `@objectstack/core`'s `isOutsideTemporalYearRange` is that range's one
  // statement), so this reads the shape, not a second copy of the range.
  return /^\d{4}-/.test(next) ? next : UNBOUNDED_ABOVE;
}

/**
 * The UTC instant a temporal comparand denotes, in epoch milliseconds — or
 * `null` when the value does not denote an instant at all.
 *
 * The companion of {@link nextUtcCalendarDay} for the OTHER half of the same
 * problem. That one answers "how wide is this bound"; this one answers "can
 * these two operands be ordered against each other at all", which is the
 * question a **type-blind** evaluator faces when one side is a JS `Date` and
 * the other is the platform's wire text. JS relational operators cannot: `<`
 * and friends coerce both operands with hint `number`, so a `Date` becomes its
 * epoch and an ISO string becomes `NaN`, and EVERY comparison between the two
 * is false regardless of the instants involved. That is the same cross-type
 * silence #4047 measured on the drivers, in the one place no schema is
 * available to prevent it.
 *
 * Accepted spellings — all unambiguous, so the answer never depends on the
 * process timezone:
 *   - a `Date` (and finite epoch-ms number);
 *   - a bare `YYYY-MM-DD` → that day's `00:00:00.000Z`, matching D-D's
 *     "a lower bound anchors to midnight" and ES's own date-only rule;
 *   - `YYYY-MM-DDTHH:MM:SS[.fff]` with an explicit `Z`/offset;
 *   - the zone-naive spelling of the same, whose wall clock **is** UTC — the
 *     platform-wide rule D-B2 states for `CURRENT_TIMESTAMP`-written rows.
 *
 * Everything else is `null`, deliberately: `Date.parse` would accept a
 * zone-naive timestamp as LOCAL time (so the same data would compare
 * differently under the temporal CI job's skewed zone) and, on V8, guesses at
 * shapes no protocol defines. A bare wall clock (`'14:30:00'`) is `null`
 * because it denotes no instant — a `Field.time` is not an instant (#2004), so
 * a type-blind surface must leave those operands exactly as it found them
 * rather than invent a calendar day for them.
 */
export function utcInstantMs(value: unknown): number | null {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // Spec-defined as UTC; parse it through the calendar-day validator so an
    // impossible day is refused here exactly as it is above.
    return nextUtcCalendarDay(s) === null ? null : Date.parse(`${s}T00:00:00.000Z`);
  }
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}${m[3] ?? 'Z'}`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Midnight UTC of a proleptic-Gregorian year, month index and day, with the
 * month and day rolled over past their ends as `Date.UTC` rolls them.
 *
 * Not `Date.UTC(year, …)` itself: it reads a year from 0 to 99 as 1900 + year,
 * so `0050-01-01` would be built as 1950-01-01, fail the round trip in
 * {@link nextUtcCalendarDay}, and every day of the years 0001..0099 would come
 * back `null` — a `$lte` or a `$between` maximum on such a day would then skip
 * whole-day widening and miss that day's rows. `setUTCFullYear` takes the
 * year as written.
 */
function utcMidnight(year: number, monthIndex: number, day: number): Date {
  const dt = new Date(0);
  dt.setUTCFullYear(year, monthIndex, day);
  return dt;
}

/** `YYYY-MM-DD` of an instant's UTC calendar day. */
function fmtUtcDay(dt: Date): string {
  return (
    `${String(dt.getUTCFullYear()).padStart(4, '0')}-` +
    `${String(dt.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(dt.getUTCDate()).padStart(2, '0')}`
  );
}
