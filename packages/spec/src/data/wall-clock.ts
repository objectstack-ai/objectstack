// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Wall clock → instant: the platform's ONE daylight-saving rule (ADR-0053,
 * ADR-0157 D11).
 *
 * A wall clock (`2026-08-01 06:00`) names a reading on a clock; only a
 * reference timezone turns it into an instant, and on a daylight-saving
 * transition day two readings are not a bijection with instants. How a
 * skipped or repeated reading resolves is a RULE, and every consumer must apply
 * the same one: bulk import's offset-free cells, the date-bucket drill ranges,
 * the working calendar's periods (ADR-0157 D11) and the working-day formula
 * functions all read through {@link zonedWallClockToUtcMs}.
 *
 * It lived in `@objectstack/core` (`utils/datetime.ts`) until ADR-0157 open
 * point 3 moved it here, as `nextUtcCalendarDay` moved before it
 * (`./calendar-day.ts`): `@objectstack/formula` depends on `@objectstack/spec`
 * and never on core, and a private copy in formula would be the second DST rule
 * D11 forbids. `@objectstack/core` re-exports both functions and the
 * {@link WallClockParts} type from its own `utils/datetime.ts`, so its published
 * surface and every caller's import site are unchanged. The bodies moved
 * verbatim; core's `datetime.test.ts` keeps pinning them through that
 * re-export.
 *
 * Pure: `Intl.DateTimeFormat` and `Date` only, no host clock and no host zone.
 */

/**
 * A wall clock as a human writes it — calendar day plus an optional
 * time-of-day, with **no zone attached**. `2026-08-01 06:00:00` is this shape:
 * it names a reading on a clock, and only a reference timezone turns it into an
 * instant. Omitted time components default to 0, so a bare calendar day
 * (`@objectstack/core`'s `CalendarParts`) is midnight.
 */
export interface WallClockParts {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
  /** 0-23. */
  hour?: number;
  minute?: number;
  second?: number;
  millisecond?: number;
}

/**
 * [#20599] The epoch milliseconds of a wall clock read as **UTC**: `Date.UTC`
 * without its two-digit-year remap. The zone-free sibling of
 * {@link zonedWallClockToUtcMs}, and the one construction this package and its
 * callers use to build a UTC instant from year / month / day / time parts.
 *
 * Not `Date.UTC(year, …)` and not `new Date(year, …)`: both read a year from 0
 * to 99 as 1900 + year (ECMA-262 `MakeFullYear`), so `0050-01-01` is built as
 * 1950-01-01 — while 0001..9999 is a `date`'s supported range ([#20280] a
 * `datetime`'s is 1000..9999; `isOutsideTemporalYearRange`).
 * `setUTCFullYear` takes the year as written.
 *
 * Every component rolls over past its end exactly as `Date.UTC` rolls it, and
 * callers rely on that: `month: 13` is January of the next year, `month: 0` is
 * December of the previous one, `day: 0` is the previous month's last day,
 * `day: 32` runs into the next month, and `hour: 24` is the next day's
 * midnight. Omitted time components default to 0. A `NaN` or non-finite
 * component, or an instant outside the `Date` range, gives `NaN`, as
 * `Date.UTC` does.
 */
export function wallClockToUtcMs(parts: WallClockParts): number {
  const dt = new Date(0);
  dt.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return dt.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, parts.millisecond ?? 0);
}

/**
 * The UTC instant (epoch ms) at which a **wall clock** reading happens in
 * reference timezone `tz` — the general inverse of `@objectstack/core`'s
 * `calendarPartsInTz`, of which its `zonedDateStartToUtcMs` is the midnight
 * special case.
 *
 * `2026-08-01 06:00:00` in `Asia/Shanghai` is `2026-07-31T22:00:00Z`: a
 * different day, month and quarter. That gap is why this direction exists as a
 * shared primitive at all — bulk import (#8485) reads offset-free spreadsheet
 * cells, which are wall clocks and nothing more, and `new Date(cell)` resolves
 * them against the **process** `TZ`, i.e. a host setting rather than the
 * tenant's configured zone.
 *
 * DST-safe: the zone offset is read from the platform tz database via
 * `Intl.DateTimeFormat` (never hand-computed), and a two-pass resolution settles
 * the case where the offset differs side-to-side of the target instant. Two
 * wall clocks are not a bijection with instants, and this function resolves
 * both degenerate cases to the **earlier candidate instant** — in both, the
 * final pass reads the offset on the DST side of the transition (measured, not
 * merely intended — `@objectstack/core`'s `datetime.test.ts` pins both):
 *  - a clock reading the zone **skips** (spring forward: `02:30` on a US
 *    spring-forward day) settles on the *post*-transition offset (EDT, −04),
 *    which places the instant just **before** the gap: it reads `01:30` EST
 *    locally, not `03:30` EDT. Note this is the opposite of Temporal's
 *    `'compatible'` disambiguation, which pushes a gap reading forward;
 *  - a clock reading that happens **twice** (fall back: `01:30` on a US
 *    fall-back day) resolves to its first occurrence, the one still on the
 *    pre-transition DST offset (EDT, −04).
 *
 * A spreadsheet cell naming a wall clock that its zone never had is ambiguous
 * by construction; what matters for an import is that the answer is
 * deterministic and host-independent, which both branches above are.
 *
 * FALLBACK — an unset, `'UTC'`, or invalid `tz` reads the wall clock **as UTC**,
 * never as the process-local clock. Every caller of this family already degrades
 * that way (`zonedDateStartToUtcMs`, and the export renderer's cell path),
 * and a host `TZ` fallback would reintroduce exactly the deployment-dependent
 * instant this primitive exists to remove. A parts object that produces an
 * invalid date (`NaN` components) returns `NaN`, as `Date.UTC` does.
 *
 * [#20599] A year from 0001 to 0099 is read as written, never as 1900 + year:
 * both the wall clock and the offset read below go through
 * {@link wallClockToUtcMs}, not `Date.UTC`. The offset read takes the zone's
 * year with its era, because `Intl`'s `year` part is an ERA year — 1 BC reads
 * `1` — and the first probe for a wall clock early on 0001-01-01 in a zone
 * west of UTC lands in year 0.
 */
export function zonedWallClockToUtcMs(parts: WallClockParts, tz?: string): number {
  const wallAsUtc = wallClockToUtcMs(parts);
  if (!tz || tz === 'UTC' || Number.isNaN(wallAsUtc)) return wallAsUtc;
  try {
    // The tz offset (local − UTC, in ms) at instant `t`: read t's wall clock in
    // `tz`, re-interpret those parts as UTC, and subtract t. `formatToParts`
    // resolves no finer than a second, so `t` is truncated to a whole second
    // first — otherwise a sub-second wall clock leaks its milliseconds into the
    // "offset" and shifts the answer by them (a real defect while generalising
    // this from the date-only form, where ms was always 0).
    const offsetAt = (t: number): number => {
      const whole = Math.floor(t / 1000) * 1000;
      const p = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        era: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(new Date(whole));
      const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
      const eraYear = g('year');
      const year = p.find((x) => x.type === 'era')?.value === 'BC' ? 1 - eraYear : eraYear;
      return (
        wallClockToUtcMs({
          year,
          month: g('month'),
          day: g('day'),
          hour: g('hour'),
          minute: g('minute'),
          second: g('second'),
        }) - whole
      );
    };
    // Want U such that localParts(U) == the wall clock, i.e. U = wallAsUtc − offset(U).
    // Iterate from the zero-offset guess; converges in ≤2 steps off a DST edge.
    const off1 = offsetAt(wallAsUtc - offsetAt(wallAsUtc));
    return wallAsUtc - off1;
  } catch {
    return wallAsUtc; // unknown zone → the wall clock read as UTC
  }
}
