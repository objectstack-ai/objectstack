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
 *
 * Half-open, never an inclusive `23:59:59.999`: the latter re-opens the gap at
 * whatever sub-millisecond precision a dialect keeps (Postgres stores
 * microseconds), and `[gte, lt)` is the shape the analytics drill ranges (#1752)
 * already emit. On a `date` column `< nextDay` is order-equivalent to
 * `<= day` under plain `YYYY-MM-DD` text ordering, which is what lets emitters
 * that cannot see the column type apply it unconditionally.
 */

/**
 * The calendar day after a bare `YYYY-MM-DD` string — the exclusive upper bound
 * of that day.
 *
 * Returns `null` for anything that is not a valid bare calendar day. That
 * refusal is load-bearing in two directions:
 *   - a full ISO timestamp or a `Date` keeps **instant** semantics and must not
 *     be widened, so callers get `null` and compile their original bound;
 *   - an impossible day (`2026-02-30`, `2026-13-01`) is rejected rather than
 *     rolled over, so a caller falls back to the untranslated comparand instead
 *     of silently querying a date the author never wrote.
 */
export function nextUtcCalendarDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const day = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const start = new Date(Date.UTC(y, mo - 1, d));
  // Reject a shape-valid but impossible day: `Date.UTC` rolls 2026-02-30 into
  // March, so the round-trip is what proves the input was a real calendar day.
  if (fmtUtcDay(start) !== day) return null;
  return fmtUtcDay(new Date(Date.UTC(y, mo - 1, d + 1)));
}

/** `YYYY-MM-DD` of an instant's UTC calendar day. */
function fmtUtcDay(dt: Date): string {
  return (
    `${String(dt.getUTCFullYear()).padStart(4, '0')}-` +
    `${String(dt.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(dt.getUTCDate()).padStart(2, '0')}`
  );
}
