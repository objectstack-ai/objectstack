/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10110 — a date-only value names a CALENDAR DAY, so it renders as
 * that day for every viewer, in every zone.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * `2026-08-01` came back from the API as `2026-08-01` and rendered `7月31日`
 * in a console whose machine zone was `America/Los_Angeles` (UTC-7), while the
 * same page in a UTC+8 browser rendered `8月1日`. ECMAScript parses the
 * date-only form as UTC midnight and this module read it back with LOCAL
 * getters, so west of UTC every date-only value lost a day. The relative
 * branch shifted with it: `2026-08-31` read `4天前` on the 3rd.
 *
 * ⭐ A suite that runs in ONE zone cannot see this class at all, and the one
 * zone this repo runs in is the single offset at which the defect is
 * invisible: `vitest.config.mts` pins `TZ=UTC` (objectui#8366). That is
 * presumably how it shipped. So the zone is an INPUT here, driven per case —
 * which is what that config's own header asks for: "Non-UTC coverage, if it
 * is ever wanted, wants an explicit per-case zone — never the runner's
 * ambient one, which is the thing that made this silent."
 *
 * ── Why the zone is driven in a CHILD PROCESS ──────────────────────────────
 * ⚠️ Writing `process.env.TZ` from inside a test does NOT move the zone here,
 * and it fails silently. Measured while writing this file: the root config
 * runs `pool: 'threads'`, a test body therefore runs in a worker thread, and
 * in a worker `process.env` is a plain copy with no native setter behind it —
 * so the assignment lands, `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * still reads `UTC`, and every date-only assertion passes for the wrong
 * reason. A rig with that shape is the phantom version of this very file.
 *
 * So each zone is read from a real child process started WITH `TZ` in its
 * environment, which is the only point at which a zone can still be chosen.
 * The child imports this module's source directly (Node 22 strips the types)
 * and prints one JSON reading; the cases below assert on those readings. The
 * clock is frozen in the child the same way, by a `Date` subclass, because
 * the relative branch is a function of "today". The first case is the rig
 * check: it asserts the child really reports the zone it was given, so a rig
 * that stopped working reds instead of going quietly green.
 *
 * ── Why both directions from UTC ───────────────────────────────────────────
 * The wrong repair is an offset that cancels the shift. It makes the reported
 * symptom go away and is wrong twice over: EAST of UTC the UTC-midnight parse
 * already lands on the right day, so a compensating shift breaks what works
 * today; and any hour arithmetic is wrong again at a DST boundary. Hence the
 * controls no offset can satisfy at once:
 *
 *   - `Asia/Shanghai` (UTC+8) and `Pacific/Kiritimati` (UTC+14) must keep
 *     rendering the named day.
 *   - `America/Santiago` on `2026-09-06`, a day whose LOCAL MIDNIGHT DOES NOT
 *     EXIST (clocks jump 00:00 → 01:00), must still render September 6th, and
 *     `America/Los_Angeles` must still read `Yesterday` across the 25-hour day
 *     that ends DST.
 *   - A value that carries a TIME is an instant and must keep converting into
 *     the viewer's zone, including when that moves it to another calendar day:
 *     `2026-08-01T03:00:00.000Z` is `Jul 31` in the west and `Aug 1` in the
 *     east, and a repair that touched instants reds there.
 *
 * ── Directions, predicted first and then MEASURED by ablating three ways ───
 * A = revert `toDisplayDate` to the plain `new Date(value)` parse (the defect).
 * B = "make the symptom go away": keep the date-only arm but hand back the
 *     parsed instant shifted twelve hours, the noon trick. C = drop the
 *     `local.setFullYear(year)` line. Columns are the observed runs, not the
 *     predictions; two predictions were wrong and are corrected below.
 *
 *                                              A      B      C
 *   rig: the child resolved the zone         green  green  green
 *   runner still pinned to UTC               green  green  green
 *   `2026-08-01` west of UTC                  RED   green  green
 *   `2026-08-01` east of UTC (+14 included)  green   RED   green
 *   the four zones agree                      RED    RED   green
 *   the `short` face                          RED   green  green
 *   a day with no local midnight              RED   green  green
 *   relative, west                            RED   green  green
 *   relative, east                           green  green  green
 *   out-of-window absolute fallback           RED   green  green
 *   `Yesterday` across the 25-hour day        RED   green  green
 *   datetime in the viewer zone              green  green  green
 *   the compact cell face                    green  green  green
 *   midnight spelled as an instant           green  green  green
 *   out-of-range month / unparsable          green  green  green
 *   the rolled impossible day (see below)     RED   green  green
 *   a two-digit year                          RED   green   RED
 *
 * ⭐ Column B is the reason the east zones are driven at all. The noon shift
 * is what "just stop it shifting" looks like written quickly: it greens every
 * case the card reported, west of UTC, and the ONLY things that catch it are
 * `Pacific/Kiritimati` (UTC+14, where noon UTC is already the next day) and
 * the all-zones-agree case. A suite that drove the reported zone alone would
 * have signed it off.
 *
 * ⚠️ Two predictions were wrong, both in the same direction — assuming a
 * DESCRIBE block moves as a unit. "`2026-08-01` east of UTC" was predicted RED
 * under A and measured green: east of UTC the UTC-midnight parse already lands
 * on the right day, which is the card's own second datum and the reason that
 * case is a control rather than a repeat. And the two-digit-year case was
 * predicted to move under C alone; it also reds under A, because its `Aug 1`
 * half shifts with every other date-only face. It is still C's only red.
 *
 * ⚠️ One row above was measured against an assertion that no longer exists.
 * "the rolled impossible day" pinned the ROLL (`2026-02-30` as March 2nd);
 * objectui#10026 rewrote that case to pin the REFUSAL instead, so its A/B/C
 * column is a historical reading of the old case, not of the case below.
 */
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/** The card's machine: UTC-7 in August, where the day was lost. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the zone the card's second browser read `8月1日` from. */
const EAST = 'Asia/Shanghai';
/** UTC+14, the far end of the same direction. */
const FAR_EAST = 'Pacific/Kiritimati';
/** UTC-4/-3, and `2026-09-06` has no local midnight there. */
const DST_WEST = 'America/Santiago';

/**
 * The card's clock: `2026-09-03T10:35Z` is `Thu Sep 3 03:35 PDT`, the morning
 * the reporter measured `4天前`. Every driven zone reads the same calendar day
 * from it, so "today" is the 3rd on both sides of UTC and the relative numbers
 * below are about the VALUE's parse and nothing else.
 */
const CARD_CLOCK = '2026-09-03T10:35:00.000Z';
/** The morning after DST ends in `America/Los_Angeles` (2026-11-01). */
const DST_CLOCK = '2026-11-02T18:00:00.000Z';

/** The probe's fixed instant, as the child spells it. */
const INSTANT_ISO = '2026-08-01T03:00:00.000Z';

/** This module's source, resolved from THIS FILE and never from the cwd. */
const MODULE_URL = new URL('../date-display.ts', import.meta.url).href;

/**
 * The reading one child takes: every face this card touches, plus the zone the
 * child actually resolved, which is what makes the rig falsifiable.
 */
const PROBE = `
const FIXED = Date.parse(process.env.OS_PROBE_NOW);
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED);
    else super(...args);
  }
  static now() { return FIXED; }
}
globalThis.Date = FrozenDate;

const m = await import(process.env.OS_PROBE_MODULE);
const EN = 'en-US';
const ZH = 'zh-CN';
const INSTANT = '2026-08-01T03:00:00.000Z';

process.stdout.write(JSON.stringify({
  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  localHourOfInstant: new Date(INSTANT).getHours(),
  absoluteEn: m.formatDate('2026-08-01', undefined, { locale: EN }),
  absoluteZh: m.formatDate('2026-08-01', undefined, { locale: ZH }),
  shortEn: m.formatDate('2026-08-01', 'short', { locale: EN }),
  relativeEn: m.formatRelativeDate('2026-08-31', { locale: EN }),
  relativeZh: m.formatRelativeDate('2026-08-31', { locale: ZH }),
  relativeOutOfWindow: m.formatRelativeDate('2026-08-01', { locale: EN }),
  relativeAcrossDstEnd: m.formatRelativeDate('2026-11-01', { locale: EN }),
  relativeToday: m.formatRelativeDate('2026-11-02', { locale: EN }),
  noLocalMidnight: m.formatDate('2026-09-06', undefined, { locale: EN }),
  datetimeEn: m.formatDateTime(INSTANT, { locale: EN }),
  datetimeCompact: m.formatDateTimeCompactParts(INSTANT, { locale: EN }),
  midnightSpelledAsInstant: m.formatDate('2026-08-01T00:00:00.000Z', undefined, { locale: EN }),
  outOfRangeMonth: m.formatDate('2026-13-01', undefined, { locale: EN }),
  unparsable: m.formatDate('not-a-date', undefined, { locale: EN }),
  impossibleDay: m.formatDate('2026-02-30', undefined, { locale: EN }),
  twoDigitYear: m.formatDate('0026-08-01', undefined, { locale: EN }),
  // objectui#10183: the parse step itself, now exported — read with the LOCAL
  // getters its doc comment names.
  displayDateLocalParts: (() => {
    const d = m.toDisplayDate('2026-08-01');
    return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()];
  })(),
  displayDateOfInstant: m.toDisplayDate(INSTANT).toISOString(),
}));
`;

type Reading = Record<string, unknown> & { zone: string };

const readings = new Map<string, Reading>();

/**
 * Read every face in `tz`, at `now`. One child per pair, memoized, because a
 * spawn is the whole cost of this file.
 */
function readIn(tz: string, now: string = CARD_CLOCK): Reading {
  const key = `${tz}@${now}`;
  const cached = readings.get(key);
  if (cached) return cached;
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', PROBE], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, TZ: tz, OS_PROBE_NOW: now, OS_PROBE_MODULE: MODULE_URL },
  });
  const reading = JSON.parse(stdout) as Reading;
  readings.set(key, reading);
  return reading;
}

describe('the zone rig (objectui#10110)', () => {
  it('reads each zone from a child that really resolved it', () => {
    expect(readIn(WEST).zone).toBe(WEST);
    expect(readIn(EAST).zone).toBe(EAST);
    expect(readIn(FAR_EAST).zone).toBe(FAR_EAST);
    expect(readIn(DST_WEST).zone).toBe(DST_WEST);
    // A fixed INSTANT read as local wall-clock hours: 03:00Z is 20:00 the
    // previous day in the west and 11:00 the same morning in the east. Were
    // the zone not moving, these would be equal and every case below would be
    // measuring UTC — green, and about nothing.
    expect(readIn(WEST).localHourOfInstant).toBe(20);
    expect(readIn(EAST).localHourOfInstant).toBe(11);
  });

  it('leaves the runner itself pinned to UTC', () => {
    // The child is the only place a zone is chosen; this file writes nothing
    // to the runner's own environment (objectui#8366 owns that pin).
    expect(process.env.TZ).toBe('UTC');
  });
});

describe('a date-only value renders the day it names, in every zone (objectui#10110)', () => {
  it('renders `2026-08-01` as August 1st west of UTC, where it read July 31st', () => {
    expect(readIn(WEST).absoluteEn).toBe('Aug 1');
    // The card's own face, in the console's locale.
    expect(readIn(WEST).absoluteZh).toBe('8月1日');
  });

  it('renders the same day east of UTC, where it was already right', () => {
    expect(readIn(EAST).absoluteEn).toBe('Aug 1');
    expect(readIn(EAST).absoluteZh).toBe('8月1日');
    expect(readIn(FAR_EAST).absoluteEn).toBe('Aug 1');
  });

  it('agrees across all four zones for one value, which is the whole claim', () => {
    const faces = [WEST, EAST, FAR_EAST, DST_WEST].map((tz) => readIn(tz).absoluteEn);
    expect(new Set(faces)).toEqual(new Set(['Aug 1']));
  });

  it('carries the `short` face with it', () => {
    expect(readIn(WEST).shortEn).toBe("Aug 1, '26");
    expect(readIn(EAST).shortEn).toBe("Aug 1, '26");
  });

  it('renders a day whose LOCAL MIDNIGHT DOES NOT EXIST as that day', () => {
    // `America/Santiago` jumps 00:00 → 01:00 on 2026-09-06. The repair asks
    // for local midnight and the runtime hands back 01:00 the same day, which
    // is still September 6th. Hour arithmetic is what misses here.
    expect(readIn(DST_WEST).noLocalMidnight).toBe('Sep 6');
  });
});

describe('the relative branch shifted for the same reason (objectui#10110)', () => {
  it('reads `2026-08-31` as 3 days ago on the 3rd, west of UTC, where it read 4', () => {
    expect(readIn(WEST).relativeEn).toBe('3 days ago');
    expect(readIn(WEST).relativeZh).toBe('3天前');
  });

  it('reads the same phrase east of UTC', () => {
    expect(readIn(EAST).relativeEn).toBe('3 days ago');
    expect(readIn(EAST).relativeZh).toBe('3天前');
  });

  it('carries into the out-of-window ABSOLUTE fallback, which is `formatDate` again', () => {
    // 33 days back leaves the ±7-day window, so this renders the absolute
    // face — the second place the same parse is read.
    expect(readIn(WEST).relativeOutOfWindow).toBe('Aug 1');
    expect(readIn(EAST).relativeOutOfWindow).toBe('Aug 1');
  });

  it('reads `Yesterday` across a 25-hour day, which no fixed offset does', () => {
    // DST ends in `America/Los_Angeles` on 2026-11-01: the 1st is 25 hours
    // long, its midnight is PDT and the 2nd's midnight is PST.
    expect(readIn(WEST, DST_CLOCK).relativeAcrossDstEnd).toBe('Yesterday');
    expect(readIn(WEST, DST_CLOCK).relativeToday).toBe('Today');
  });
});

describe('a value that carries an instant keeps converting (objectui#10110)', () => {
  it('renders a `datetime` in the VIEWER zone, including onto another day', () => {
    expect(readIn(WEST).datetimeEn).toBe('Jul 31, 2026, 08:00 PM');
    expect(readIn(EAST).datetimeEn).toBe('Aug 1, 2026, 11:00 AM');
  });

  it('keeps the compact cell face converting too', () => {
    expect(readIn(WEST).datetimeCompact).toEqual({ date: '7/31/2026', time: '8:00 pm' });
    expect(readIn(EAST).datetimeCompact).toEqual({ date: '8/1/2026', time: '11:00 am' });
  });

  it('treats a date-TIME spelling of midnight as the instant it is, not as a calendar day', () => {
    // The split is the VALUE's shape: `2026-08-01T00:00:00.000Z` says UTC
    // midnight out loud, so the west still reads July 31st from it. Unchanged
    // by the repair, and the case a blanket offset would break.
    expect(readIn(WEST).midnightSpelledAsInstant).toBe('Jul 31');
    expect(readIn(EAST).midnightSpelledAsInstant).toBe('Aug 1');
  });
});

describe('the exported parse step (objectui#10183)', () => {
  it('hands back local midnight of the day a date-only value names, in every zone', () => {
    // Callers outside this module format or compare this `Date` themselves;
    // local midnight is what makes their local-zone reads name the right day.
    for (const tz of [WEST, EAST, FAR_EAST]) {
      expect(readIn(tz).displayDateLocalParts, tz).toEqual([2026, 8, 1, 0]);
    }
  });

  it('leaves an instant exactly the instant it was', () => {
    expect(readIn(WEST).displayDateOfInstant).toBe(INSTANT_ISO);
    expect(readIn(EAST).displayDateOfInstant).toBe(INSTANT_ISO);
  });
});

describe('what the shared display path accepts is unchanged by the zone repair (objectui#10110)', () => {
  it('still dashes an out-of-range month and an unparsable value, in either direction', () => {
    expect(readIn(WEST).outOfRangeMonth).toBe('—');
    expect(readIn(EAST).outOfRangeMonth).toBe('—');
    expect(readIn(WEST).unparsable).toBe('—');
  });

  it('refuses a well-shaped impossible day with the unparsable dash, in every zone (objectui#10026)', () => {
    // This case pinned the ROLL until objectui#10026: `2026-02-30` parses and
    // rendered March 2nd (March 1st west of UTC before this card's repair).
    // The maintainer's ruling on #10026 made the shared path refuse it with
    // the dash it renders for an unparsable value, so the refusal is what
    // must agree across zones now. `impossibleDay-10026` beside this file owns
    // the refusal itself; this case keeps the zone half of it.
    expect(readIn(WEST).impossibleDay).toBe(readIn(WEST).unparsable);
    expect(readIn(EAST).impossibleDay).toBe(readIn(EAST).unparsable);
    expect(readIn(WEST).impossibleDay).toBe('—');
  });

  it('keeps a two-digit year out of the 1900s', () => {
    // The multi-argument `Date` constructor maps years 0-99 onto 1900+y, which
    // the string parse does not. The face for year 26 is locale data, so this
    // asserts the year that must NOT appear rather than a rendered literal.
    const face = readIn(WEST).twoDigitYear as string;
    expect(face).toContain('Aug 1');
    expect(face).not.toContain('1926');
  });
});
