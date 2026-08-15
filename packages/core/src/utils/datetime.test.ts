// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `zonedDateStartToUtcMs` turns a bucket's first calendar day (in the reference
// timezone) into the UTC instant that day BEGINS — used to scope a `datetime`
// date-bucket drill (#1752). It must be DST-safe: the offset comes from the tz
// database, and midnight must land exactly on the day boundary in that zone.

import { describe, it, expect } from 'vitest';
import {
  zonedDateStartToUtcMs,
  zonedWallClockToUtcMs,
  calendarPartsInTz,
  nextUtcCalendarDay,
} from './datetime.js';

const iso = (s: string) => Date.parse(s);

describe('zonedDateStartToUtcMs — exact boundaries', () => {
  it('UTC / unset / unknown zone → plain UTC midnight', () => {
    expect(zonedDateStartToUtcMs('2026-06-01', 'UTC')).toBe(iso('2026-06-01T00:00:00Z'));
    expect(zonedDateStartToUtcMs('2026-06-01')).toBe(iso('2026-06-01T00:00:00Z'));
    expect(zonedDateStartToUtcMs('2026-06-01', 'Not/AZone')).toBe(iso('2026-06-01T00:00:00Z'));
  });

  it('fixed positive offset (Asia/Shanghai, +08, no DST)', () => {
    // Shanghai June 1 00:00 (+08) === May 31 16:00 UTC.
    expect(zonedDateStartToUtcMs('2026-06-01', 'Asia/Shanghai')).toBe(iso('2026-05-31T16:00:00Z'));
  });

  it('DST zone — summer vs winter offset (America/New_York)', () => {
    // June → EDT (−04): midnight === 04:00 UTC.
    expect(zonedDateStartToUtcMs('2026-06-01', 'America/New_York')).toBe(iso('2026-06-01T04:00:00Z'));
    // January → EST (−05): midnight === 05:00 UTC.
    expect(zonedDateStartToUtcMs('2026-01-01', 'America/New_York')).toBe(iso('2026-01-01T05:00:00Z'));
  });

  it('DST transition days — midnight is before the 2am switch, so uses the pre-switch offset', () => {
    // Spring-forward day (2026-03-08): midnight still EST (−05).
    expect(zonedDateStartToUtcMs('2026-03-08', 'America/New_York')).toBe(iso('2026-03-08T05:00:00Z'));
    // Fall-back day (2026-11-01): midnight still EDT (−04).
    expect(zonedDateStartToUtcMs('2026-11-01', 'America/New_York')).toBe(iso('2026-11-01T04:00:00Z'));
  });

  it('unparseable input → NaN', () => {
    expect(Number.isNaN(zonedDateStartToUtcMs('2026-06', 'UTC'))).toBe(true);
    expect(Number.isNaN(zonedDateStartToUtcMs('nope', 'America/New_York'))).toBe(true);
  });
});

describe('zonedDateStartToUtcMs — round-trips to the day boundary in the zone', () => {
  const cases: Array<[string, string]> = [
    ['2026-06-01', 'Asia/Shanghai'],
    ['2026-06-01', 'America/New_York'],
    ['2026-01-01', 'America/New_York'],
    ['2026-02-15', 'UTC'],
  ];
  for (const [ymd, tz] of cases) {
    it(`${ymd} @ ${tz}: the instant is that calendar day, and 1ms earlier is the previous day`, () => {
      const ms = zonedDateStartToUtcMs(ymd, tz);
      const [y, m, d] = ymd.split('-').map(Number);
      // The instant falls on the target calendar day in `tz`…
      expect(calendarPartsInTz(new Date(ms), tz)).toEqual({ year: y, month: m, day: d });
      // …and one millisecond earlier is the day before → it is exactly midnight.
      expect(calendarPartsInTz(new Date(ms - 1), tz)).not.toEqual({ year: y, month: m, day: d });
    });
  }
});

// ---------------------------------------------------------------------------
// [#8485] The general wall-clock → instant direction. `zonedDateStartToUtcMs`
// is now its midnight special case, so everything above is also coverage of
// this function's date-only path.
//
// Every fixture below straddles a **month** boundary or a DST edge on purpose:
// a mid-day, mid-month wall clock converts correctly under a surprising number
// of wrong implementations (including the process-`TZ` read this exists to
// replace), so it proves nothing.
// ---------------------------------------------------------------------------

const SHANGHAI = 'Asia/Shanghai';
const NEW_YORK = 'America/New_York';

describe('zonedWallClockToUtcMs — a wall clock is not an instant until a zone says so', () => {
  it('the reported cell: 2026-08-01 06:00 in +08 is the previous MONTH in UTC', () => {
    expect(zonedWallClockToUtcMs({ year: 2026, month: 8, day: 1, hour: 6 }, SHANGHAI)).toBe(
      iso('2026-07-31T22:00:00Z'),
    );
  });

  it('cross-month at the other end: 2026-09-01 00:30 +08 is 2026-08-31 in UTC', () => {
    expect(
      zonedWallClockToUtcMs({ year: 2026, month: 9, day: 1, hour: 0, minute: 30 }, SHANGHAI),
    ).toBe(iso('2026-08-31T16:30:00Z'));
  });

  it('the same wall clock is a different instant in summer and in winter (DST zone)', () => {
    // EDT (−04) in June, EST (−05) in January — one hand-rolled fixed offset
    // would get exactly one of these two right.
    expect(zonedWallClockToUtcMs({ year: 2026, month: 6, day: 15, hour: 12 }, NEW_YORK)).toBe(
      iso('2026-06-15T16:00:00Z'),
    );
    expect(zonedWallClockToUtcMs({ year: 2026, month: 1, day: 15, hour: 12 }, NEW_YORK)).toBe(
      iso('2026-01-15T17:00:00Z'),
    );
  });

  it('a sub-minute offset zone (Asia/Kathmandu, +05:45)', () => {
    expect(zonedWallClockToUtcMs({ year: 2026, month: 8, day: 1, hour: 6 }, 'Asia/Kathmandu')).toBe(
      iso('2026-08-01T00:15:00Z'),
    );
  });

  it('milliseconds survive the conversion', () => {
    // `formatToParts` resolves to whole seconds, so an offset read at the
    // untruncated instant carried the milliseconds INTO the offset and shifted
    // the answer by them — measured while generalising the date-only form,
    // where ms was always 0 and the bug could not appear.
    expect(
      zonedWallClockToUtcMs(
        { year: 2026, month: 8, day: 1, hour: 6, minute: 0, second: 0, millisecond: 123 },
        SHANGHAI,
      ),
    ).toBe(iso('2026-07-31T22:00:00.123Z'));
  });

  it('both degenerate DST readings resolve to the earlier candidate instant', () => {
    // The local clock reading an instant shows in NEW_YORK, e.g. '01:30 EST'.
    const localAt = (ms: number) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: NEW_YORK, hourCycle: 'h23',
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
      }).format(new Date(ms));

    // Spring forward: 02:30 never happens on 2026-03-08 in New York. The
    // two-pass settles on the POST-transition offset (EDT, −04), which places
    // the answer just BEFORE the gap — 01:30 EST, not 03:30 EDT. (The opposite
    // of Temporal's 'compatible' disambiguation; pinned here because it is the
    // deterministic, host-independent answer, which is what an import needs.)
    const gap = zonedWallClockToUtcMs({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NEW_YORK);
    expect(gap).toBe(iso('2026-03-08T06:30:00Z'));
    expect(calendarPartsInTz(new Date(gap), NEW_YORK)).toEqual({ year: 2026, month: 3, day: 8 });
    expect(localAt(gap)).toBe('01:30 EST');
    // …and it is the EARLIER of the two candidates: reading 02:30 through the
    // pre-transition offset (EST, −05) instead would have given 07:30Z.
    expect(gap).toBeLessThan(iso('2026-03-08T07:30:00Z'));

    // Fall back: 01:30 happens TWICE on 2026-11-01. The first (EDT, −04) wins.
    const ambiguous = zonedWallClockToUtcMs(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NEW_YORK,
    );
    expect(ambiguous).toBe(iso('2026-11-01T05:30:00Z'));
    expect(localAt(ambiguous)).toBe('01:30 EDT');
    // The second occurrence (EST, −05) is 06:30Z — the later candidate.
    expect(ambiguous).toBeLessThan(iso('2026-11-01T06:30:00Z'));
  });

  it('no zone / UTC / an unknown zone reads the wall clock as UTC — never the process clock', () => {
    // The pinned fallback (#8485): the export renderer writes UTC when no
    // business timezone resolves, so import must read UTC to stay its inverse.
    const noon = { year: 2026, month: 8, day: 1, hour: 6, minute: 0 };
    expect(zonedWallClockToUtcMs(noon)).toBe(iso('2026-08-01T06:00:00Z'));
    expect(zonedWallClockToUtcMs(noon, 'UTC')).toBe(iso('2026-08-01T06:00:00Z'));
    expect(zonedWallClockToUtcMs(noon, 'Not/AZone')).toBe(iso('2026-08-01T06:00:00Z'));
  });

  it('an impossible parts object is NaN, as Date.UTC gives', () => {
    expect(Number.isNaN(zonedWallClockToUtcMs({ year: NaN, month: 1, day: 1 }, SHANGHAI))).toBe(true);
  });

  it('is the exact generalisation: midnight parts === zonedDateStartToUtcMs', () => {
    for (const [ymd, tz] of [
      ['2026-06-01', SHANGHAI],
      ['2026-06-01', NEW_YORK],
      ['2026-01-01', NEW_YORK],
      ['2026-03-08', NEW_YORK],
      ['2026-11-01', NEW_YORK],
      ['2026-02-15', 'UTC'],
      ['2026-02-15', 'Not/AZone'],
    ] as Array<[string, string]>) {
      const [year, month, day] = ymd.split('-').map(Number);
      expect(zonedWallClockToUtcMs({ year, month, day }, tz)).toBe(zonedDateStartToUtcMs(ymd, tz));
    }
  });

  it('does NOT widen zonedDateStartToUtcMs — that one is still date-only', () => {
    // The generalisation is a NEW entry point, not a loosened old one: the
    // bucket-drill callers pass canonical `YYYY-MM-DD` keys and a datetime
    // slipping through would silently scope a drill range to a mid-day instant.
    expect(Number.isNaN(zonedDateStartToUtcMs('2026-06-01 12:00:00', SHANGHAI))).toBe(true);
    expect(Number.isNaN(zonedDateStartToUtcMs('2026-06-01T12:00:00Z', SHANGHAI))).toBe(true);
  });

  it('round-trips: the instant shows exactly that wall clock in the zone', () => {
    for (const [tz, parts] of [
      [SHANGHAI, { year: 2026, month: 8, day: 1, hour: 6, minute: 0, second: 0 }],
      [NEW_YORK, { year: 2026, month: 6, day: 15, hour: 23, minute: 59, second: 59 }],
      [NEW_YORK, { year: 2026, month: 12, day: 31, hour: 23, minute: 30, second: 0 }],
      ['Pacific/Kiritimati', { year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0 }],
    ] as Array<[string, Required<Omit<Parameters<typeof zonedWallClockToUtcMs>[0], 'millisecond'>>]>) {
      const d = new Date(zonedWallClockToUtcMs(parts, tz));
      const back = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(d);
      const g = (k: string) => Number(back.find((p) => p.type === k)?.value);
      expect({
        year: g('year'), month: g('month'), day: g('day'),
        hour: g('hour'), minute: g('minute'), second: g('second'),
      }).toEqual(parts);
    }
  });
});

describe('nextUtcCalendarDay — re-exported from @objectstack/spec (ADR-0053 D-D)', () => {
  it('is still reachable from this package, with the same semantics', () => {
    // The rule itself now lives in spec (six backends share it, and
    // `@objectstack/formula` cannot depend on core) — its thorough coverage is
    // `packages/spec/src/data/calendar-day.test.ts`. What this asserts is the
    // re-export the drivers and analytics strategies import from HERE, so
    // dropping it would break them loudly rather than at their call sites.
    expect(nextUtcCalendarDay('2026-07-28')).toBe('2026-07-29');
    expect(nextUtcCalendarDay('2026-07-28T12:00:00Z')).toBeNull();
  });
});
