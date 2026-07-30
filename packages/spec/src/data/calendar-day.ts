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

/** `YYYY-MM-DD` of an instant's UTC calendar day. */
function fmtUtcDay(dt: Date): string {
  return (
    `${String(dt.getUTCFullYear()).padStart(4, '0')}-` +
    `${String(dt.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(dt.getUTCDate()).padStart(2, '0')}`
  );
}
